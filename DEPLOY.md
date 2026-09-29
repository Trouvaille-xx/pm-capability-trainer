# 部署

本应用原本是「纯本地跑」的：数据写成 `data/` 下的 JSON 文件，没有账号体系，
默认绑 `localhost`。放到公网要补三件事 —— 监听端口、访问控制、数据持久化。

## 前置条件

服务器上需要有 **Node 20+** 与 **pm2**。本仓库的部署脚本用 pm2 托管
（而不是 docker），因为多数服务器上已经有 pm2 在跑别的服务，沿用同一套
更省事：日志、开机自启、重启策略都走同一条路。

```bash
# 没有的话
npm i -g pm2
pm2 startup    # 按提示执行它回显的那条 sudo 命令，才能开机自启
```

## 部署

```bash
# 1. 把代码放到服务器（任选一种）
rsync -az --exclude node_modules --exclude .next --exclude data \
      ./ user@host:/path/to/pm-trainer/
# 或：git clone 到服务器

# 2. 配置环境变量
cd /path/to/pm-trainer
cp .env.example .env
nano .env      # 至少改 BASIC_AUTH_PASS

# 3. 构建并启动
bash deploy.sh
```

`deploy.sh` 是幂等的：重复跑只会重新构建并 `pm2 reload`，不会重复注册进程。

## 环境变量

| 变量 | 说明 |
|---|---|
| `PORT` | 监听端口，默认 8081 |
| `PM_TRAINER_DATA_DIR` | 数据目录，默认 `<项目根>/data` |
| `BASIC_AUTH_USER` | 访问用户名 |
| `BASIC_AUTH_PASS` | 访问密码 |

**认证是可选的**：`BASIC_AUTH_USER` 与 `BASIC_AUTH_PASS` 两个都设上才生效；
不设就完全不加锁（本地开发就是这种情况）。

⚠️ **放到公网务必设上。** 这个应用没有账号体系，接口虽然不回传密钥明文
（见 `src/lib/settings.ts` 的投影），但没有登录就等于任何能访问到端口的人
都能读写你的全部记录、题库与方法论。

## 访问控制在哪实现的

`proxy.ts`（项目根）。Next 16 把 `middleware` 改名成了 `proxy` ——
文件与导出名都换了，见 `node_modules/next/dist/docs/.../proxy.md`。

它排除了静态资源（`_next/static` 等）：不排除的话 CSS/JS 会被 401 拦下，
页面直接白屏。

## 数据

全部数据在 `data/` 下的 JSON 文件里，**不上云、不进 git**（`.gitignore` 已排除）。
备份就是打包这个目录：

```bash
tar czf pm-data-$(date +%F).tgz -C /path/to/pm-trainer data
```

迁移到新机器：把 `data/` 一起带过去即可。

## HTTPS

默认是 HTTP。要在公网用，建议前面挂一层 Nginx 做 TLS 终结：

```nginx
server {
  listen 443 ssl;
  server_name your.domain;
  # ssl_certificate ...;   # 用 certbot 签一张免费的
  location / {
    proxy_pass http://127.0.0.1:8081;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

没有域名就只能用 `http://IP:PORT` —— 密码走明文，心里要有数。

## 常用命令

```bash
pm2 logs pm-trainer          # 看日志
pm2 restart pm-trainer       # 改了 .env 后要带 --update-env
pm2 delete pm-trainer        # 卸载
```
