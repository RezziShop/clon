const WebSocket = require('ws');
const express = require('express');
const { validate } = require('@tma.js/init-data-node');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Храним соединения устройств по deviceId
const deviceSockets = new Map();
// Храним pending запросы от Mini App
const pendingRequests = new Map();

// WebSocket для Android-хостов
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const deviceId = url.searchParams.get('device');
  
  if (!deviceId) {
    ws.close();
    return;
  }
  
  deviceSockets.set(deviceId, ws);
  console.log(`Устройство ${deviceId} подключено`);
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      // Ответ на команду из Mini App
      if (msg.requestId && pendingRequests.has(msg.requestId)) {
        const res = pendingRequests.get(msg.requestId);
        res.json(msg);
        pendingRequests.delete(msg.requestId);
      }
    } catch (e) {}
  });
  
  ws.on('close', () => {
    deviceSockets.delete(deviceId);
  });
});

// API для Telegram Mini App
app.post('/api/clone', async (req, res) => {
  // 1. Валидация initData
  const authHeader = req.headers.authorization;
  const initData = authHeader?.replace('tma ', '');
  
  try {
    validate(initData, process.env.BOT_TOKEN);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid initData' });
  }
  
  // Извлекаем telegramId пользователя (можно использовать как идентификатор устройства)
  const urlParams = new URLSearchParams(initData);
  const user = JSON.parse(urlParams.get('user'));
  const telegramId = user.id.toString();
  
  const { packageName, deviceId } = req.body; // deviceId должен быть передан с клиента
  
  const ws = deviceSockets.get(deviceId);
  if (!ws) {
    return res.status(404).json({ error: 'Device offline' });
  }
  
  const requestId = crypto.randomUUID();
  
  // Сохраняем ответ для этого запроса
  pendingRequests.set(requestId, res);
  
  // Отправляем команду на устройство
  ws.send(JSON.stringify({
    type: 'clone',
    packageName,
    userId: 0,
    requestId
  }));
  
  // Таймаут 30 секунд
  setTimeout(() => {
    if (pendingRequests.has(requestId)) {
      pendingRequests.delete(requestId);
      res.status(504).json({ error: 'Timeout' });
    }
  }, 30000);
});

// API для получения списка приложений
app.post('/api/list_apps', (req, res) => {
  // Аналогичная валидация...
  const { deviceId } = req.body;
  const ws = deviceSockets.get(deviceId);
  // ... отправка команды list_apps и ожидание ответа
});

const server = app.listen(3000);
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
