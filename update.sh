#!/usr/bin/env bash
#
# update.sh —— 一键发布博客
#
#   ./update.sh                  # 提交信息自动带时间戳
#   ./update.sh "新增文章：xxx"   # 自定义提交信息
#
# 流程：本地构建 → 提交 → 推送；推送后 GitHub Actions 自动构建并部署到 Pages。
#
# 可迁移性说明：
#   - 不写死任何绝对路径，靠脚本自身位置定位项目根目录，
#     因此项目放到哪台机器、哪个目录都能直接跑，也支持软链接调用。
#   - 推送使用仓库已配置的远程地址与本机 git 凭据，脚本里不含任何 token。

set -euo pipefail

# --- 定位项目根目录：逐级解开软链接，取脚本真实所在目录 ---
src="${BASH_SOURCE[0]:-$0}"
while [ -L "$src" ]; do
    link_dir="$(cd -P "$(dirname "$src")" && pwd)"
    src="$(readlink "$src")"
    case "$src" in
        /*) ;;
        *)  src="$link_dir/$src" ;;
    esac
done
cd "$(cd -P "$(dirname "$src")" && pwd)"

if [ ! -d .git ]; then
    echo "错误：$(pwd) 不是 git 仓库，无法发布。" >&2
    exit 1
fi

msg="${1:-更新于 $(date '+%Y-%m-%d %H:%M')}"

echo "==> 1/3 本地构建（构建失败会中止，不会推送）"
if ! python3 -c "import jinja2, marko, pygments, yaml" >/dev/null 2>&1; then
    echo "    缺少依赖，请先执行：pip install -r requirements.txt" >&2
    exit 1
fi
make build

echo "==> 2/3 提交改动"
git add -A
if git diff --cached --quiet; then
    echo "    没有改动，跳过提交"
else
    git commit -m "$msg"
fi

echo "==> 3/3 推送到远程，触发 CI 部署"
git push

site_url="$(python3 -c 'from generator.config import CONFIG; print(CONFIG["site_url"])' 2>/dev/null || true)"
echo
echo "✅ 已推送，约 1 分钟后上线：${site_url:-（见仓库 Pages 设置）}"
