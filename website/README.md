# RUYI 官网部署指南

## 目录结构

```
website/
├── index.html          # 主页面
├── style.css           # 样式文件
└── assets/
    ├── ruyi-avatar.png  # 吉祥物图片
    └── qrcode.png      # 内测群二维码（需替换）
```

## 待完成的配置

### 1. 替换 GitHub 仓库地址

在 `index.html` 中，需要将以下占位链接替换为实际的 GitHub 仓库地址：

- `https://github.com/user/ruyi` → 替换为实际仓库地址
- `https://github.com/user/ruyi/releases/latest` → 替换为实际 Releases 页面

### 2. 替换内测群二维码

将 `assets/qrcode.png` 替换为实际的内测群二维码图片。

### 3. 部署到 GitHub Pages

#### 方式一：从 main 分支 /website 目录部署

1. 将代码推送到 GitHub
2. 进入仓库 Settings → Pages
3. Source 选择 `main` 分支，目录选择 `/website`
4. 保存后等待部署完成

#### 方式二：创建 gh-pages 分支

1. 创建 gh-pages 分支：
   ```bash
   git checkout -b gh-pages
   cd website
   git add -A
   git commit -m "Deploy website"
   git push origin gh-pages
   ```

2. 进入仓库 Settings → Pages
3. Source 选择 `gh-pages` 分支
4. 保存后等待部署完成

### 4. 创建 Release

打包完成后执行：

```bash
# 创建标签
git tag v0.2.0
git push origin v0.2.0

# 然后在 GitHub 网页上：
# 1. 进入仓库的 Releases 页面
# 2. 点击 "Draft a new release"
# 3. 选择 v0.2.0 标签
# 4. 填写 Release 标题和说明
# 5. 上传 .dmg 和 .msi 安装包
# 6. 发布 Release
```

## 访问地址

部署完成后，网站将可通过以下地址访问：
- `https://[username].github.io/[repo-name]/`

## 本地预览

直接用浏览器打开 `index.html` 即可本地预览：

```bash
open website/index.html
```
