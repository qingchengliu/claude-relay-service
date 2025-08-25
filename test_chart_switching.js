// 测试图表切换功能的脚本
// 在浏览器控制台中运行此代码来测试标签页切换时图表的重新渲染

console.log('=== 测试图表切换功能 ===')

// 模拟切换到用户统计明细
console.log('1. 切换到用户统计明细...')
document.querySelector('button[data-tab="users"]')?.click()

setTimeout(() => {
  console.log('2. 切换回全局统计概览...')
  document.querySelector('button[data-tab="overview"]')?.click()

  setTimeout(() => {
    // 检查图表是否正确渲染
    const trendChart = document.querySelector('canvas[data-chart="trend"]')
    const languageChart = document.querySelector('canvas[data-chart="language"]')

    console.log('3. 检查图表状态...')
    console.log('趋势图表画布:', trendChart ? '存在' : '不存在')
    console.log('语言图表画布:', languageChart ? '存在' : '不存在')

    if (trendChart && languageChart) {
      console.log('✅ 图表元素存在，切换功能正常')
    } else {
      console.log('❌ 图表元素缺失，需要检查实现')
    }
  }, 1000)
}, 2000)
