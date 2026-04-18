const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const QRCode = require('qrcode');

// 生成设备唯一标识
function generateDeviceId() {
  return 'dev_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// 数据持久化
const DATA_FILE = 'data.json';
let data = {
  files: [],
  messages: [],
  users: [],
  chats: []
};

// 加载历史数据
if (fs.existsSync(DATA_FILE)) {
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    // 确保数据结构完整
    if (!data.users) data.users = [];
    if (!data.files) data.files = [];
    if (!data.messages) data.messages = [];
    if (!data.chats) data.chats = [];
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

// 保存数据
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// 获取服务器所有IP地址
function getServerIPs() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const ips = [];
  
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        ips.push(alias.address);
      }
    }
  }
  
  // 如果没有找到外部IP地址，添加本地地址
  if (ips.length === 0) {
    ips.push('127.0.0.1');
  }
  
  return ips;
}

const serverIPs = getServerIPs();
const mainServerIP = serverIPs[0];
const app = express();

// 添加API端点返回网络访问地址
app.get('/api/server/info', (req, res) => {
  res.json({
    serverIPs: serverIPs,
    mainServerIP: mainServerIP,
    networkUrls: serverIPs.map(ip => `http://${ip}:3000`),
    mainNetworkUrl: `http://${mainServerIP}:3000`
  });
});

// 解析JSON请求体
app.use(express.json());

// 添加CORS中间件
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  
  next();
});

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  path: '/socket.io'
});

// 获取当前工作目录
const cwd = process.cwd();

// 确保必要的目录存在
const uploadsDir = path.join(cwd, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('Created uploads directory:', uploadsDir);
}

app.set('view engine', 'ejs');
app.set('views', path.join(cwd, 'views'));
app.use(express.static(path.join(cwd, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

app.get('/', (req, res) => {
  res.render('index');
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }
  
  const fileInfo = {
    id: Date.now().toString(),
    name: req.file.originalname,
    path: 'uploads/' + req.file.filename,
    size: req.file.size,
    url: `/download/${req.file.filename}`,
    timestamp: new Date().toISOString()
  };
  
  data.files.push(fileInfo);
  saveData();
  
  io.emit('fileUploaded', fileInfo);
  res.json(fileInfo);
});

app.get('/api/history', (req, res) => {
  res.json(data);
});

app.get('/download/:filename', (req, res) => {
  const filePath = path.join(cwd, 'uploads', req.params.filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('File not found.');
  }
});

io.on('connection', (socket) => {
  console.log('A user connected');
  
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
  
  socket.on('sendMessage', (message) => {
    const messageInfo = {
      id: Date.now().toString(),
      content: message.content,
      fromDeviceId: message.fromDeviceId,
      fromDeviceName: message.fromDeviceName,
      timestamp: new Date().toISOString()
    };
    data.messages.push(messageInfo);
    saveData();
    io.emit('message', messageInfo);
  });
  
  // 处理私聊消息
  socket.on('privateMessage', (message) => {
    // 保存聊天记录
    const chatKey = [message.fromDeviceId, message.toDeviceId].sort().join('-');
    let chat = data.chats.find(c => c.key === chatKey);
    if (!chat) {
      chat = {
        key: chatKey,
        participants: [message.fromDeviceId, message.toDeviceId],
        messages: []
      };
      data.chats.push(chat);
    }
    
    // 添加消息到聊天记录
    chat.messages.push({
      fromDeviceId: message.fromDeviceId,
      fromDeviceName: message.fromDeviceName,
      toDeviceId: message.toDeviceId,
      content: message.content,
      timestamp: message.timestamp || new Date().toISOString()
    });
    
    saveData();
    
    // 转发消息给目标设备
    io.emit('privateMessage', message);
  });
});

app.get('/api/server-url', (req, res) => {
  const serverURL = `http://${mainServerIP}:${process.env.PORT || 3000}`;
  res.json({ url: serverURL });
});

app.get('/api/qrcode', (req, res) => {
  const serverURL = `http://${mainServerIP}:${process.env.PORT || 3000}`;
  QRCode.toDataURL(serverURL, {
    width: 200,
    margin: 1
  }, (err, url) => {
    if (err) {
      console.error('Error generating QR code:', err);
      res.status(500).send('Error generating QR code');
    } else {
      res.json({ qrCodeUrl: url });
    }
  });
});

app.delete('/api/files/:id', (req, res) => {
  const fileId = req.params.id;
  
  // 找到要删除的文件
  const fileIndex = data.files.findIndex(file => file.id === fileId);
  if (fileIndex === -1) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  const file = data.files[fileIndex];
  
  // 删除文件
  try {
    // 使用绝对路径确保文件被正确删除
    const absolutePath = path.join(cwd, file.path);
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
      console.log('File deleted:', absolutePath);
    } else {
      console.log('File not found:', absolutePath);
    }
    
    // 从数据中移除
    data.files.splice(fileIndex, 1);
    saveData();
    
    // 通知所有客户端文件已删除
    io.emit('fileDeleted', fileId);
    
    res.json({ success: true, message: 'File deleted successfully' });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Error deleting file' });
  }
});

// 用户管理API
app.post('/api/user/register', (req, res) => {
  const deviceId = req.body.deviceId || generateDeviceId();
  const deviceName = req.body.deviceName || 'Unknown Device';
  
  // 检查用户是否已存在
  let user = data.users.find(u => u.deviceId === deviceId);
  if (!user) {
    user = {
      id: Date.now().toString(),
      deviceId: deviceId,
      deviceName: deviceName,
      friends: [],
      friendRequests: []
    };
    data.users.push(user);
    saveData();
  }
  
  res.json({ user });
});

app.post('/api/friend/request', (req, res) => {
  const { fromDeviceId, toDeviceId, message } = req.body;
  
  // 找到或创建发送者
  let sender = data.users.find(u => u.deviceId === fromDeviceId);
  if (!sender) {
    sender = {
      id: Date.now().toString(),
      deviceId: fromDeviceId,
      deviceName: 'Unknown Device',
      friends: [],
      friendRequests: []
    };
    data.users.push(sender);
  }
  
  // 找到或创建接收者
  let receiver = data.users.find(u => u.deviceId === toDeviceId);
  if (!receiver) {
    receiver = {
      id: Date.now().toString(),
      deviceId: toDeviceId,
      deviceName: 'Unknown Device',
      friends: [],
      friendRequests: []
    };
    data.users.push(receiver);
  }
  
  // 检查是否已经是好友
  const isAlreadyFriend = sender.friends.some(f => f.deviceId === toDeviceId) || 
                        receiver.friends.some(f => f.deviceId === fromDeviceId);
  
  if (isAlreadyFriend) {
    return res.status(400).json({ error: 'Already friends' });
  }
  
  // 创建好友申请
  const request = {
    id: Date.now().toString(),
    fromDeviceId: fromDeviceId,
    fromDeviceName: sender.deviceName,
    toDeviceId: toDeviceId,
    message: message || '',
    timestamp: new Date().toISOString(),
    status: 'pending'
  };
  
  // 添加到接收者的好友申请列表
  receiver.friendRequests.push(request);
  saveData();
  
  // 通知接收者有新的好友申请
  io.emit('friendRequest', { user: receiver, request });
  
  res.json({ success: true, message: 'Friend request sent' });
});

app.post('/api/friend/accept', (req, res) => {
  const { deviceId, requestId } = req.body;
  
  // 找到用户
  const user = data.users.find(u => u.deviceId === deviceId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // 找到好友申请
  const requestIndex = user.friendRequests.findIndex(r => r.id === requestId);
  if (requestIndex === -1) {
    return res.status(404).json({ error: 'Friend request not found' });
  }
  
  const request = user.friendRequests[requestIndex];
  
  // 找到发送者
  const sender = data.users.find(u => u.deviceId === request.fromDeviceId);
  if (!sender) {
    return res.status(404).json({ error: 'Sender not found' });
  }
  
  // 添加好友关系
  user.friends.push({
    deviceId: request.fromDeviceId,
    deviceName: request.fromDeviceName,
    addedAt: new Date().toISOString()
  });
  
  sender.friends.push({
    deviceId: user.deviceId,
    deviceName: user.deviceName,
    addedAt: new Date().toISOString()
  });
  
  // 更新申请状态
  request.status = 'accepted';
  
  saveData();
  
  // 通知双方好友添加成功
  io.emit('friendAdded', { user1: user, user2: sender });
  
  res.json({ success: true, message: 'Friend request accepted' });
});

app.get('/api/user/:deviceId', (req, res) => {
  const deviceId = req.params.deviceId;
  const user = data.users.find(u => u.deviceId === deviceId);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json({ user });
});

app.post('/api/user/update', (req, res) => {
  const { deviceId, deviceName } = req.body;
  
  // 找到用户
  const user = data.users.find(u => u.deviceId === deviceId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // 更新昵称
  user.deviceName = deviceName;
  
  // 更新所有好友列表中的昵称
  data.users.forEach(u => {
    if (u.friends) {
      u.friends.forEach(friend => {
        if (friend.deviceId === deviceId) {
          friend.deviceName = deviceName;
        }
      });
    }
  });
  
  saveData();
  
  res.json({ success: true, user });
});

app.post('/api/friend/remove', (req, res) => {
  const { deviceId, friendDeviceId } = req.body;
  
  // 找到当前用户
  const user = data.users.find(u => u.deviceId === deviceId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // 找到好友用户
  const friend = data.users.find(u => u.deviceId === friendDeviceId);
  if (!friend) {
    return res.status(404).json({ error: 'Friend not found' });
  }
  
  // 从双方好友列表中移除
  user.friends = user.friends.filter(f => f.deviceId !== friendDeviceId);
  if (friend.friends) {
    friend.friends = friend.friends.filter(f => f.deviceId !== deviceId);
  }
  
  saveData();
  
  res.json({ success: true, message: 'Friend removed successfully' });
});

app.get('/api/chat/:deviceId1/:deviceId2', (req, res) => {
  const { deviceId1, deviceId2 } = req.params;
  const chatKey = [deviceId1, deviceId2].sort().join('-');
  const chat = data.chats.find(c => c.key === chatKey);
  
  if (chat) {
    res.json({ messages: chat.messages });
  } else {
    res.json({ messages: [] });
  }
});

// 处理私聊文件
app.post('/api/file/private', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  const { toDeviceId, fromDeviceId, fromDeviceName } = req.body;
  
  const fileInfo = {
    id: Date.now().toString(),
    name: req.file.originalname,
    path: req.file.path,
    size: req.file.size,
    url: `/download/${req.file.filename}`,
    fromDeviceId: fromDeviceId,
    fromDeviceName: fromDeviceName,
    toDeviceId: toDeviceId,
    timestamp: new Date().toISOString()
  };
  
  // 保存聊天记录
  const chatKey = [fromDeviceId, toDeviceId].sort().join('-');
  let chat = data.chats.find(c => c.key === chatKey);
  if (!chat) {
    chat = {
      key: chatKey,
      participants: [fromDeviceId, toDeviceId],
      messages: []
    };
    data.chats.push(chat);
  }
  
  // 添加文件消息到聊天记录
  chat.messages.push({
    fromDeviceId: fromDeviceId,
    fromDeviceName: fromDeviceName,
    toDeviceId: toDeviceId,
    content: `<a href="${fileInfo.url}" target="_blank">${fileInfo.name}</a> (${(fileInfo.size / 1024).toFixed(2)} KB)`,
    timestamp: fileInfo.timestamp,
    type: 'file',
    fileId: fileInfo.id,
    filePath: fileInfo.path
  });
  
  saveData();
  
  // 通知接收者有新的私聊文件
  io.emit('privateFile', fileInfo);
  
  res.json({ success: true, file: fileInfo });
});

// 删除私聊文件
app.delete('/api/files/private/:fileId', (req, res) => {
  const fileId = req.params.fileId;
  
  try {
    // 查找并删除文件
    let fileFound = false;
    let filePath = null;
    
    // 遍历所有聊天记录，删除包含该文件的消息
    data.chats.forEach(chat => {
      const messageIndex = chat.messages.findIndex(msg => msg.fileId === fileId);
      if (messageIndex !== -1) {
        // 保存文件路径以便删除实际文件
        if (chat.messages[messageIndex].filePath) {
          filePath = chat.messages[messageIndex].filePath;
        }
        chat.messages.splice(messageIndex, 1);
        fileFound = true;
      }
    });
    
    if (!fileFound) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // 删除服务器上的实际文件
    if (filePath) {
      const absolutePath = path.join(cwd, filePath);
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
        console.log('Private file deleted:', absolutePath);
      }
    }
    
    saveData();
    res.json({ success: true, message: 'File deleted successfully' });
  } catch (error) {
    console.error('Error deleting private file:', error);
    res.status(500).json({ error: 'Error deleting file' });
  }
});



// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Local access: http://localhost:${PORT}`);
  
  // 显示所有网络访问地址
  serverIPs.forEach((ip, index) => {
    const networkUrl = `http://${ip}:${PORT}`;
    if (index === 0) {
      console.log(`Main network access: ${networkUrl}`);
      console.log(`Scan this URL with your mobile device: ${networkUrl}`);
    } else {
      console.log(`Alternative network access: ${networkUrl}`);
    }
  });
});