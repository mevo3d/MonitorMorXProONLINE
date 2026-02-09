// ecosystem.config.js - Configuración PM2 para Auto-Restart 24/7
module.exports = {
  apps: [
    {
      name: 'monitor-legislativo',
      script: './src/index.js',
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      kill_timeout: 5000,
      listen_timeout: 10000,
      shutdown_with_message: true,
      exp_backoff_restart_delay: 100,
      // Autocargue tras crash
      autodump: true,
      // Variables de entorno específicas
      env_production: {
        NODE_ENV: 'production',
        HEADLESS: 'true'
      }
    }
  ],
  deploy: {
    production: {
      user: 'root',
      host: 'your-digitalocean-ip',
      ref: 'origin/main',
      repo: 'git@github.com:username/monitor-legislativo-v3.git',
      path: '/var/www/monitor-legislativo',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': 'apt-get install git && apt-get install -y nodejs && apt-get install -y postgresql-client'
    }
  }
};
