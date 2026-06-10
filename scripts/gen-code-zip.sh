#!/bin/bash

# 生成排除 .gitignore 文件的代码压缩包

OUTPUT_NAME="Abu-code.zip"

# 检查是否在 git 仓库中
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "错误: 当前目录不是 git 仓库"
    exit 1
fi

# 使用 git archive 生成压缩包
echo "正在生成代码压缩包..."
git archive --format zip --output "$OUTPUT_NAME" HEAD

if [ -f "$OUTPUT_NAME" ]; then
    SIZE=$(ls -lh "$OUTPUT_NAME" | awk '{print $5}')
    echo "完成! 已生成 $OUTPUT_NAME ($SIZE)"
else
    echo "错误: 压缩包生成失败"
    exit 1
fi
