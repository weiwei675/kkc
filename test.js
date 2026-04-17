const http = require('http');
const fs = require('fs');
const path = require('path');

// 测试服务器是否正常运行
const testServer = () => {
  console.log('测试服务器连接...');
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/',
    method: 'GET'
  };

  const req = http.request(options, (res) => {
    console.log(`服务器状态码: ${res.statusCode}`);
    if (res.statusCode === 200) {
      console.log('服务器连接成功！');
    } else {
      console.log('服务器连接失败！');
    }
  });

  req.on('error', (e) => {
    console.error(`请求错误: ${e.message}`);
  });

  req.end();
};

// 运行测试
testServer();