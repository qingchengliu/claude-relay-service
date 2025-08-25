// 测试Bash命令统计功能
const statistics = require('./plugins/code-statistics/statistics')

console.log('=== 测试Bash命令统计功能 ===\n')

// 测试数据：模拟Claude响应包含Bash命令
const testResponses = [
  {
    name: 'echo创建文件',
    response: {
      content: [
        {
          type: 'tool_use',
          name: 'Bash',
          input: {
            command: 'echo "Hello World" > test.txt'
          }
        }
      ]
    }
  },
  {
    name: 'cat创建多行文件',
    response: {
      content: [
        {
          type: 'tool_use',
          name: 'Bash',
          input: {
            command: 'cat > config.py'
          }
        }
      ]
    }
  },
  {
    name: 'sed原地编辑',
    response: {
      content: [
        {
          type: 'tool_use',
          name: 'Bash',
          input: {
            command: 'sed -i "s/old/new/g" script.sh'
          }
        }
      ]
    }
  },
  {
    name: 'touch创建空文件',
    response: {
      content: [
        {
          type: 'tool_use',
          name: 'Bash',
          input: {
            command: 'touch newfile.js'
          }
        }
      ]
    }
  },
  {
    name: 'vim编辑文件',
    response: {
      content: [
        {
          type: 'tool_use',
          name: 'Bash',
          input: {
            command: 'vim main.cpp'
          }
        }
      ]
    }
  },
  {
    name: 'PowerShell Set-Content',
    response: {
      content: [
        {
          type: 'tool_use',
          name: 'Bash',
          input: {
            command: 'Set-Content -Path config.txt -Value "Hello World"'
          }
        }
      ]
    }
  },
  {
    name: 'PowerShell New-Item文件',
    response: {
      content: [
        {
          type: 'tool_use',
          name: 'Bash',
          input: {
            command: 'New-Item -Path newfile.ps1 -ItemType File'
          }
        }
      ]
    }
  },
  {
    name: 'PowerShell Export-Csv',
    response: {
      content: [
        {
          type: 'tool_use',
          name: 'Bash',
          input: {
            command: 'Get-Process | Export-Csv -Path processes.csv'
          }
        }
      ]
    }
  },
  {
    name: 'PowerShell重定向',
    response: {
      content: [
        {
          type: 'tool_use',
          name: 'Bash',
          input: {
            command: 'Get-Date > timestamp.txt'
          }
        }
      ]
    }
  },
  {
    name: '非编辑命令',
    response: {
      content: [
        {
          type: 'tool_use',
          name: 'Bash',
          input: {
            command: 'ls -la'
          }
        }
      ]
    }
  },
  {
    name: '组合：Edit + Bash',
    response: {
      content: [
        {
          type: 'tool_use',
          name: 'Edit',
          input: {
            file_path: 'app.py',
            new_string: 'print("Hello")\nprint("World")'
          }
        },
        {
          type: 'tool_use',
          name: 'Bash',
          input: {
            command: 'echo "#!/bin/bash" > deploy.sh'
          }
        }
      ]
    }
  }
]

// 执行测试
testResponses.forEach((test, index) => {
  console.log(`${index + 1}. ${test.name}`)

  const stats = statistics.extractEditStatistics(test.response)

  console.log('   统计结果:', {
    编辑行数: stats.totalEditedLines,
    操作次数: stats.editOperations,
    新建文件: stats.newFiles,
    修改文件: stats.modifiedFiles,
    语言分布: stats.languages,
    文件类型: stats.fileTypes
  })
  console.log()
})

// 测试单独的Bash命令分析
console.log('=== 测试Bash命令分析功能 ===\n')

const bashCommands = [
  'echo "content" > file.txt',
  'cat >> log.txt',
  'sed -i "s/old/new/" config.json',
  'vim script.py',
  'touch README.md',
  'cp source.js target.js',
  'ls -la',
  'grep "pattern" file.txt',
  // PowerShell 命令测试
  'Set-Content -Path config.ps1 -Value "# Config"',
  'Add-Content test.txt -Value "New line"',
  'Get-Process | Out-File processes.txt',
  'New-Item -Path newfile.ps1 -ItemType File',
  'Copy-Item source.txt destination.txt',
  'Move-Item old.txt new.txt',
  'Get-Service | Tee-Object services.log',
  'Get-Date | ConvertTo-Json > date.json',
  'Get-Process | Export-Csv processes.csv',
  'dir > listing.txt',
  'notepad++ script.js'
]

bashCommands.forEach((command, index) => {
  const analysis = statistics.analyzeBashCommand(command)
  console.log(`${index + 1}. ${command}`)
  console.log('   分析结果:', {
    是否编辑: analysis.isFileEdit,
    操作类型: analysis.operation,
    目标文件: analysis.targetFile
  })
  console.log()
})
