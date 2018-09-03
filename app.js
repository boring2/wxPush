'use strict'

var express = require('express')
var timeout = require('connect-timeout')
var path = require('path')
var cookieParser = require('cookie-parser')
var bodyParser = require('body-parser')
var AV = require('leanengine')
var crypto = require('crypto')
var request = require('request')

//https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=wxbf1467a671c44813&secret=762c09a891e29903c446dbd637d61a23

// 加载云函数定义，你可以将云函数拆分到多个文件方便管理，但需要在主文件中加载它们
require('./cloud')

var app = express()

// 设置模板引擎
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')

app.use(express.static('public'))

// 设置默认超时时间
app.use(timeout('15s'))

// 加载云引擎中间件
app.use(AV.express())

app.enable('trust proxy')
// 需要重定向到 HTTPS 可去除下一行的注释。
// app.use(AV.Cloud.HttpsRedirect());

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))
app.use(cookieParser())

app.get('/', function(req, res) {
	checkSignature(req.query) ? res.send(req.query.echostr) : res.send('error')
})

let access_token

let accessTokenUrl = 'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=wxbf1467a671c44813&secret=762c09a891e29903c446dbd637d61a23'

const getAccessToken = function () {
	if (access_token) {
		return access_token
	}
	let options = {
		method: 'GET',
		url: accessTokenUrl
	}
	return new Promise((resolve, reject) => {
		request(options, function (err, res, body) {
			if (res) {
				access_token = JSON.parse(body).access_token
				let expires_in = parseInt(JSON.parse(body).expires_in) - 10
				setTimeout(() => {
					access_token = ''
				}, expires_in * 1000)
				resolve(access_token)
			} else {
				reject(err)
			}
		})
	})
}

const postJson = function (params) {
	let options = {
		url: params.url,
		method: 'POST',
		body: params.body,
		json: true
	}
	request(options, function (error, res) {
		if (!error && res.statusCode === 200) {
			params.success(res.errcode)
		} else {
			params.error(error)
		}
	})
}

async function sendTextMessage (content, data, access_token) {
  await postJson({
    url: `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${access_token}`,
    body: {
      touser: data.FromUserName,
      msgtype: 'text',
      text: {
        content: content
      }
    },
    success: function (res) {
      console.log('post json--- success', res)
    },
    error: function (err) {
      console.error('post json--- error', err)
    }
  })
}
app.post('/', function(req, res, next) {

  let reqBody = req.body;
  let isCheck = checkSignature({
    signature: req.query.signature,
    timestamp: req.query.timestamp,
    nonce: req.query.nonce,
  });
  if (isCheck) {
    let welcome = `感谢您使用编呗\n如果您想加入编辑团可编辑#加入编辑团#+内容回复\n如果您想投稿可编辑#我要投稿#+内容回复`
    switch (reqBody.MsgType) {
      case 'text': {
        //文本消息
        sendTextMessage('您的消息已收到,我们会尽快回复.', reqBody, getAccessToken())
        break
      }
      case 'event': {
        sendTextMessage(welcome, reqBody, getAccessToken())
        break
      }
      default:
        break
    }
  }
  res.send('success')
  next()
  res.end()
})

function checkSignature(params){
	//token 就是自己填写的令牌
	let token = 'boringwxpush'
	var key=[token, params.timestamp, params.nonce].sort().join('')
	//将token （自己设置的） 、timestamp（时间戳）、nonce（随机数）三个参数进行字典排序
	var sha1 = crypto.createHash('sha1')
	//将上面三个字符串拼接成一个字符串再进行sha1加密
	sha1.update(key)

	return sha1.digest('hex') === params.signature
	//将加密后的字符串与signature进行对比，若成功，返回echostr
}

// 可以将一类的路由单独保存在一个文件中
app.use('/wxpush', require('./routes/wxpush'))

app.use(function(req, res, next) {
	// 如果任何一个路由都没有返回响应，则抛出一个 404 异常给后续的异常处理器
	if (!res.headersSent) {
		var err = new Error('Not Found')
		err.status = 404
		next(err)
	}
})

// error handlers
app.use(function(err, req, res, next) {
	if (req.timedout && req.headers.upgrade === 'websocket') {
		// 忽略 websocket 的超时
		return
	}

	var statusCode = err.status || 500
	if (statusCode === 500) {
		console.error(err.stack || err)
	}
	if (req.timedout) {
		console.error('请求超时: url=%s, timeout=%d, 请确认方法执行耗时很长，或没有正确的 response 回调。', req.originalUrl, err.timeout)
	}
	res.status(statusCode)
	// 默认不输出异常详情
	var error = {}
	if (app.get('env') === 'development') {
		// 如果是开发环境，则将异常堆栈输出到页面，方便开发调试
		error = err
	}
	res.render('error', {
		message: err.message,
		error: error
	})
})

module.exports = app
