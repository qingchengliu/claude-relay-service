#!/bin/bash

# Bash命令统计功能验证脚本

echo "=== Claude Relay Service - Bash命令统计验证 ==="
echo

# 获取认证Token
echo "1. 获取认证Token..."
TOKEN=$(curl -s -X POST -H "Content-Type: application/json" \
  -d '{"username":"cr_admin_2044bc66","password":"F0k8quHK8ckTtGsv"}' \
  http://localhost:3001/web/auth/login | jq -r '.token')

if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo "❌ 获取Token失败"
  exit 1
fi
echo "✅ Token获取成功: ${TOKEN:0:20}..."
echo

# 模拟Claude Code执行Bash命令的API请求
echo "2. 模拟Claude Code API请求..."

# 构造请求数据 - 模拟Claude的响应格式
REQUEST_DATA='{
  "keyId": "test-key-123",
  "usageData": {
    "model": "claude-3-sonnet-20240229",
    "totalTokens": 100,
    "inputTokens": 50, 
    "outputTokens": 50
  },
  "model": "claude-3-sonnet-20240229",
  "response": {
    "content": [
      {
        "type": "tool_use",
        "name": "Bash",
        "input": {
          "command": "echo \"# My Script\" > script.sh"
        }
      }
    ]
  }
}'

# 直接调用统计钩子（需要创建测试端点）
echo "3. 执行文件编辑命令统计测试..."

# 测试多种Bash命令
COMMANDS=(
  "echo \"Hello World\" > test.txt"
  "cat > config.py"
  "echo \"line 2\" >> test.txt"
  "sed -i 's/old/new/g' config.py"
  "touch README.md" 
  "vim main.cpp"
  "ls -la"
  # PowerShell命令测试
  "Set-Content -Path config.ps1 -Value \"# PowerShell Config\""
  "Add-Content test.log -Value \"New log entry\""
  "Get-Process | Out-File processes.txt"
  "New-Item -Path newfile.ps1 -ItemType File"
  "Copy-Item source.txt destination.txt"
  "Move-Item old.txt renamed.txt"
  "Get-Date | ConvertTo-Json > timestamp.json"
  "Get-Service | Export-Csv services.csv"
  "notepad++ script.js"
)

for i in "${!COMMANDS[@]}"; do
  cmd="${COMMANDS[$i]}"
  echo "   测试命令 $((i+1)): $cmd"
  
  # 使用Node.js直接测试统计逻辑
  node -e "
    const stats = require('./plugins/code-statistics/statistics');
    const response = {
      content: [{
        type: 'tool_use',
        name: 'Bash', 
        input: { command: \`$cmd\` }
      }]
    };
    const result = stats.extractEditStatistics(response);
    console.log('     结果:', {
      lines: result.totalEditedLines,
      ops: result.editOperations,
      create: result.newFiles,
      modify: result.modifiedFiles,
      lang: Object.keys(result.languages)[0] || 'none'
    });
  " 2>/dev/null || echo "     ❌ 测试失败"
  echo
done

# 检查统计数据
echo "4. 检查现有统计数据..."
echo "   系统级统计:"
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/admin/code-stats/system?days=1" | \
  jq '.data.daily[0] // {}'

echo
echo "   用户排行榜:"
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/admin/code-stats/leaderboard?limit=3" | \
  jq '.data[] | {user: .userName, lines: .totalEditedLines}' 2>/dev/null || echo "   暂无数据"

echo
echo "5. 访问Web界面查看详细统计："
echo "   URL: http://localhost:3001/web"
echo "   用户: cr_admin_2044bc66"
echo "   密码: F0k8quHK8ckTtGsv"
echo
echo "=== 验证完成 ==="