const path = require('path');
console.log('__dirname:', __dirname);
console.log('process.cwd():', process.cwd());
console.log('Current directory:', process.cwd());

// 测试路径解析
const viewsPath = path.join(__dirname, 'views');
console.log('Views path:', viewsPath);

const publicPath = path.join(__dirname, 'public');
console.log('Public path:', publicPath);

const uploadsPath = path.join(__dirname, 'uploads');
console.log('Uploads path:', uploadsPath);