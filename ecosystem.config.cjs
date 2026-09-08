module.exports = {
    apps: [
        {
            name: "oms-bot-api",
            script: "./dist/index.js",
            instances: 1,
            exec_mode: "fork",
            autorestart: true,
            watch: false,
            max_memory_restart: "500M",
            env: {
                PORT: 8000,
                NODE_ENV: "production",
            },
            error_file: "./logs/pm2-error.log",
            out_file: "./logs/pm2-out.log",
            log_date_format: "YYYY-MM-DD HH:mm:ss",
        },
    ],
};