const Redis = require("ioredis")
const uuid = require('uuid').v4

const STATUS = {
    WORKING: 'WORKING',
    ERROR: 'ERROR'
}

const SESSIONS = {}

const instance = (serviceKey) => SESSIONS[serviceKey]

const successKey = (serviceKey = uuid()) => `${serviceKey}-sucess-count`;
const errorKey = (serviceKey = uuid()) => `${serviceKey}-error-count`;

const __getCounter = ({context}) => async (countername) => {
    let value = context.counter[countername] || 0;
    if (context.redisConnectionFactory) {
        const redis = context.redisConnectionFactory();
        const remoteValue = await redis.get(countername);
        redis.quit();
        return Math.max(value, (parseInt(`${remoteValue}`, 10) || 0));
    }
    return value;
}

const __setCounter = ({context}) => (countername, value) => {
    context.counter[countername] = value
    if (context.redisConnectionFactory) {
        const redis = context.redisConnectionFactory();
        redis.set(countername, value);
        redis.quit();
    }
}

const __setStatus = ({context}) => (sts) => {
    if (context.status !== sts) context.onStatusChange(context.serviceKey, sts);
    context.status = sts;
    if (context.redisConnectionFactory) {
        const redis = context.redisConnectionFactory();
        redis.set(context.serviceKey, sts);
        redis.quit();
    }
}

const __failing = ({context}) => async () => {
    return __getCounter({context})(errorKey(context.serviceKey)).then((count) => {
        if (count < 10) {
            __setCounter({context})(errorKey(context.serviceKey), (count + 1) || 1);
        }

        // after N errors
        if (count >= context.minErrorCount) {
            // its crashing
            __setCounter({context})(successKey(context.serviceKey), 0);
            __setStatus({context})(STATUS.ERROR);
        };
    });
}

const __working = ({context}) => async () => {
    return __getCounter({context})(successKey(context.serviceKey)).then((count) => {
        if (count < 10) {
            __setCounter({context})(successKey(context.serviceKey), (count + 1) || 1);
        }
        // after N success
        if (count >= context.minSucessCount) {
            // its working again
            __setCounter({context})(errorKey(context.serviceKey), 0);
            __setStatus({context})(STATUS.WORKING);
        };
    });
}

const __defaultCheck = ({context}) => async () => {
    return new Promise((resolve, reject) => {
        const signal =  AbortSignal.timeout(context.maxTimeout * 1000);
        try {
            return fetch(context.checkUrl, { signal })
                .then(resolve)
                .catch(reject);
        } catch (err) { reject(err) }
    });
}

const __instrumented = ({context}) => {
    return (context.checkUrl ? __defaultCheck({context})() : checkFn({context})())
        .then(__working({context}))
        .catch(__failing({context}));
}

const call = ({context}) => async (fn, fallBack) => {
    if (context.status === STATUS.WORKING) {
        return Promise.resolve(fn())
            .catch((err) => {
                return __failing({context})()
                .then(() => fallBack ? fallBack() : Promise.reject('resource failure'))
            })
    }
    return fallBack ? fallBack() : Promise.reject('resource failure')
}

const stop = ({context}) => () => {
    clearInterval(context.intervalHandler)
    context.intervalHandler = undefined
    delete SESSIONS[context.serviceKey];
}

const start = ({context}) => () => {
    context.intervalHandler = setInterval(
        () => __instrumented({context}),
        context.checkIntervalInSeconds * 1000
    );

    SESSIONS[context.serviceKey] = context;
    return {
        context,
        call: call({context}),
        stop: stop({context}),
    };
}

const Configure = ({
    serviceKey = uuid(),
    checkIntervalInSeconds = 30,
    minSucessCount = 1,
    minErrorCount = 1,
    checkUrl,
    maxTimeout = 30,
    redisConnectionFactory,
    checkFn = () => Promise.resolve({}),
    onStatusChange = () => {}}) => {

    const context = {
        serviceKey,
        status: STATUS.WORKING,
        checkIntervalInSeconds,
        minSucessCount,
        minErrorCount,
        checkUrl,
        maxTimeout,
        redisConnectionFactory,
        checkFn,
        onStatusChange,
        counter: {},
    }

    return { start: start({context}) }
}

module.exports = { instance, Configure }