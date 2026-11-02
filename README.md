# UwU / 章鱼喷墨机

这是一个由 HTML、CSS 和 JavaScript 组成的静态网页项目，入口为 `index.html`，可以直接部署到 GitHub Pages，无需安装依赖或运行构建命令。

## 上传到 GitHub

1. 登录 GitHub，创建一个名为 `uwu` 的仓库。使用免费个人账户部署时，选择 **Public**（公开）。
2. 新建空仓库后，点击 **uploading an existing file**；如果仓库已有文件，点击 **Add file → Upload files**。
3. 打开电脑上的 `uwu` 文件夹，把里面的全部文件和 `css`、`js` 文件夹拖入上传区域，保持目录结构。
4. 确认 `index.html` 直接位于仓库根目录，与 `css`、`js` 同级。不要把最外层 `uwu` 文件夹整个上传成一层子目录，也不要只上传 ZIP 压缩包。
5. 填写提交说明，提交到 `main` 分支。

上传后的结构应类似：

```text
index.html
community_detail.html
css/
js/
contacts.css
more_menu.css
style.css
manifest.json
sw.js
.nojekyll
README.md
```

## 开启 GitHub Pages

1. 在仓库中打开 **Settings → Pages**。
2. 在 **Build and deployment** 中，把 **Source** 设为 **Deploy from a branch**。
3. **Branch** 选择 `main`，目录选择 **/ (root)**，点击 **Save**。如果实际上传到其他分支，则选择那个分支。
4. 等待部署完成，刷新 Pages 设置页，点击 **Visit site** 查看网站。

如果仓库名为 `uwu`，默认网站地址为：

```text
https://你的GitHub用户名.github.io/uwu/
```

这是地址格式示例，实际链接以 Pages 设置页显示的地址为准。

## 后续更新

将修改后的文件上传并提交到发布分支，GitHub Pages 会自动重新部署。需要保留 `css` 和 `js` 的原有目录结构。

网页中的聊天和图片生成等功能仍需在应用设置中配置相应服务；静态网页托管本身不提供这些 API。

官方说明：

- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository
