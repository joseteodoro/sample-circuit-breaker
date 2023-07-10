const express = require('express')
const uuid = require('uuid').v4
const app = express()
const port = 9000

app.get('/data', (req, res) => {
  res.json({content: uuid()})
})

app.listen(port, () => {
  console.log(`Targer sever under circuit breaker example listening on port ${port}`)
})