const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// Endpoint to pull config
// GET /sync/:userId
app.get('/sync/:userId', (req, res) => {
  const { userId } = req.params;
  const filePath = path.join(DATA_DIR, `${userId}.json`);
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath, 'utf8');
    res.json(JSON.parse(data));
  } else {
    res.status(404).json({ error: 'No config found' });
  }
});

// Endpoint to push config
// POST /sync/:userId
app.post('/sync/:userId', (req, res) => {
  const { userId } = req.params;
  const filePath = path.join(DATA_DIR, `${userId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf8');
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sync server running on http://localhost:${PORT}`);
});
