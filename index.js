const express = require('express')
const { Configure } = require('./circuit-breaker');
const Redis = require("ioredis")

const app = express()
const port = 3000

app.get('/no-cb', async (req, res) => {
    return fetch('http://localhost:9000/data')
        .then((response) => response.json())
        .then((body) => {
            res.json({message: `content from target server: ${JSON.stringify(body)}`})
        })
        .catch(err => {
            res.status(500).json({message: `error getting contetn from target server: ${err}`})
        });
})

const circuitBreaker = Configure({
    serviceKey: 'localhost/data',
    checkUrl: 'http://localhost:9000/data',
    checkIntervalInSeconds: 5,
    minErrorCount: 1,
    minSucessCount: 1,
    redisConnectionFactory: () => new Redis(),
    onStatusChange: (service, status) => console.log(`${service} changed to ${status}`)
}).start();

const getRemoteData = async () => fetch('http://localhost:9000/data')
    .then((response) => response.json())

const fallBack = async () => 'under maintenance'

app.get('/with-cb', async (req, res) => {
    circuitBreaker.call(
        // normal call
        getRemoteData,
        // a simple fallback
        fallBack,
    )
    .then((body) => {
        return res.json({message: body})
    })
    .catch((err) => {
        return res.status(500).json(err)
    });
})

app.get('/without-fallback', async (req, res) => {
    circuitBreaker.call(
        // normal call
        getRemoteData,
    )
    .then((body) => {
        return res.json({message: body})
    })
    .catch((err) => {
        return res.status(500).json(err)
    });
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})