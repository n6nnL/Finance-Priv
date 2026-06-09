// ============================================================
//  ecosystem.config.cjs — pm2 тохиргоо (listener + API хоёр процесс)
//
//  Ажиллуулах:   pm2 start ecosystem.config.cjs
//  Лог үзэх:     pm2 logs            (эсвэл pm2 logs bank-listener)
//  Дахин ачаалах: pm2 reload all
//  Reboot-д авто: pm2 save && pm2 startup
//
//  ⚠️ node:sqlite ашигладаг тул Node 22.5+ (зөвлөмж: Node 24 LTS) шаардлагатай.
// ============================================================

const path = require('path');
const root = __dirname;

const common = {
  interpreter: 'node',
  exec_mode: 'fork',
  instances: 1,
  autorestart: true, // унтарвал автомат сэргээнэ
  min_uptime: '30s', // restart loop-оос сэргийлэх
  max_restarts: 20,
  restart_delay: 5000,
  merge_logs: true,
  time: true,
  env: { NODE_ENV: 'production', LOG_PRETTY: '0' }, // JSON лог (production)
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'bank-listener', // Gmail IMAP IDLE listener (байнгын)
      script: path.join(root, 'src', 'index.js'),
      cwd: root, // DB_PATH=./data/listener.sqlite энд хадгална
      max_memory_restart: '300M',
      output: path.join(root, 'logs', 'listener-out.log'),
      error: path.join(root, 'logs', 'listener-err.log'),
    },
    {
      ...common,
      name: 'bank-api', // Express API + dashboard static serve
      script: path.join(root, 'api', 'server.js'),
      cwd: path.join(root, 'api'), // DB_PATH=./data/transactions.sqlite энд
      max_memory_restart: '250M',
      output: path.join(root, 'logs', 'api-out.log'),
      error: path.join(root, 'logs', 'api-err.log'),
    },
  ],
};
