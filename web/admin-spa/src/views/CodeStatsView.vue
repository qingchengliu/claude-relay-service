<template>
  <div class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
    <div class="mx-auto max-w-7xl">
      <!-- 页面标题 -->
      <div class="mb-8 flex items-center justify-between">
        <div>
          <h1 class="mb-2 text-3xl font-bold text-gray-900">📊 代码统计分析</h1>
          <p class="text-gray-600">追踪 Claude 代码编辑操作的详细统计数据</p>
        </div>
        <button
          class="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-400"
          :disabled="loading"
          @click="refreshData"
        >
          <i :class="['fas', loading ? 'fa-spinner fa-spin' : 'fa-sync-alt']"></i>
          {{ loading ? '刷新中...' : '刷新数据' }}
        </button>
      </div>

      <!-- 模块选择标签页 -->
      <div class="mb-8">
        <div class="border-b border-gray-200">
          <nav class="-mb-px flex space-x-8">
            <button
              class="whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium"
              :class="
                activeTab === 'overview'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              "
              @click="activeTab = 'overview'"
            >
              📈 全局统计概览
            </button>
            <button
              class="whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium"
              :class="
                activeTab === 'tools'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              "
              @click="activeTab = 'tools'"
            >
              🔧 工具调用统计
            </button>
          </nav>
        </div>
      </div>

      <!-- 全局统计概览模块 -->
      <div v-if="activeTab === 'overview'">
        <!-- 时间段选择器 -->
        <div class="mb-6 flex justify-end">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-gray-700">统计时间段：</span>
            <div class="flex rounded-lg border border-gray-200 bg-white">
              <button
                v-for="option in timePeriodOptions"
                :key="option.value"
                @click="changeOverviewTimePeriod(option.value)"
                :class="[
                  'px-3 py-1.5 text-sm font-medium transition-all duration-200 first:rounded-l-lg last:rounded-r-lg',
                  overviewTimePeriod === option.value
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                ]"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
        </div>

        <!-- 统计卡片 -->
        <div class="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-5">
          <!-- 编辑行数卡片 -->
          <div class="rounded-lg bg-white p-4 shadow-lg">
            <div class="flex items-center justify-center">
              <div class="flex-1 text-center">
                <p class="mb-2 text-xs font-semibold text-gray-600 sm:text-sm">
                  {{ getOverviewCardTitle('编辑行数') }}
                </p>
                <p class="text-xl font-bold text-blue-600 sm:text-2xl md:text-3xl">
                  {{ formatNumber(systemStats?.periodLines || 0) }}
                </p>
              </div>
              <div class="flex items-center justify-center" style="width: 25%">
                <div
                  class="flex h-14 w-14 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white"
                >
                  <i class="fas fa-edit text-xl" />
                </div>
              </div>
            </div>
          </div>
          <!-- 创建文件次数卡片 -->
          <div class="rounded-lg bg-white p-4 shadow-lg">
            <div class="flex items-center justify-center">
              <div class="flex-1 text-center">
                <p class="mb-2 text-xs font-semibold text-gray-600 sm:text-sm">
                  {{ getOverviewCardTitle('创建文件次数') }}
                </p>
                <p class="text-xl font-bold text-purple-600 sm:text-2xl md:text-3xl">
                  {{ formatNumber(systemStats?.periodNewFiles || 0) }}
                </p>
              </div>
              <div class="flex items-center justify-center" style="width: 25%">
                <div
                  class="flex h-14 w-14 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 text-white"
                >
                  <i class="fas fa-file-plus text-xl" />
                </div>
              </div>
            </div>
          </div>
          <!-- 修改文件次数卡片 -->
          <div class="rounded-lg bg-white p-4 shadow-lg">
            <div class="flex items-center justify-center">
              <div class="flex-1 text-center">
                <p class="mb-2 text-xs font-semibold text-gray-600 sm:text-sm">
                  {{ getOverviewCardTitle('修改文件次数') }}
                </p>
                <p class="text-xl font-bold text-orange-600 sm:text-2xl md:text-3xl">
                  {{ formatNumber(systemStats?.periodModifiedFiles || 0) }}
                </p>
              </div>
              <div class="flex items-center justify-center" style="width: 25%">
                <div
                  class="flex h-14 w-14 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 text-white"
                >
                  <i class="fas fa-file-edit text-xl" />
                </div>
              </div>
            </div>
          </div>
          <!-- 活跃人数卡片 -->
          <div class="rounded-lg bg-white p-4 shadow-lg">
            <div class="flex items-center justify-center">
              <div class="flex-1 text-center">
                <p class="mb-2 text-xs font-semibold text-gray-600 sm:text-sm">
                  {{ getOverviewCardTitle('活跃人数') }}
                </p>
                <p class="text-xl font-bold text-emerald-600 sm:text-2xl md:text-3xl">
                  {{ formatNumber(activeUsersCount || 0) }}
                </p>
              </div>
              <div class="flex items-center justify-center" style="width: 25%">
                <div
                  class="flex h-14 w-14 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 text-white"
                >
                  <i class="fas fa-users text-xl" />
                </div>
              </div>
            </div>
          </div>
          <!-- Token卡片 -->
          <div class="rounded-lg bg-white p-4 shadow-lg">
            <div class="flex items-center justify-center">
              <div class="flex-1 text-center">
                <p class="mb-2 text-xs font-semibold text-gray-600 sm:text-sm">
                  {{ getOverviewCardTitle('Token') }}
                </p>
                <p class="text-xl font-bold text-indigo-600 sm:text-2xl md:text-3xl">
                  {{ formatTokens(dashboardOverview?.todayTokens || 0) }}
                </p>
                <p class="text-sm font-medium text-green-600">
                  {{ dashboardOverview?.totalCost || '$0.00' }}
                </p>
              </div>
              <div class="flex items-center justify-center" style="width: 25%">
                <div
                  class="flex h-14 w-14 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 text-white"
                >
                  <i class="fas fa-coins text-xl" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 图表区域 -->
        <div class="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <!-- 编辑趋势图 -->
          <div class="rounded-lg bg-white p-6 shadow-lg">
            <h3 class="mb-4 text-lg font-semibold text-gray-900">📈 编辑趋势</h3>
            <div class="relative h-64 w-full">
              <canvas ref="trendChart" class="absolute inset-0 h-full w-full"></canvas>
            </div>
          </div>

          <!-- 语言分布图 -->
          <div class="rounded-lg bg-white p-6 shadow-lg">
            <h3 class="mb-4 text-lg font-semibold text-gray-900">🌍 编程语言分布</h3>
            <div class="relative h-64 w-full">
              <canvas ref="languageChart" class="absolute inset-0 h-full w-full"></canvas>
            </div>
          </div>
        </div>

        <!-- 排行榜 -->
        <div class="rounded-lg bg-white p-6 shadow-lg">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-lg font-semibold text-gray-900">
              🏆 {{ getOverviewCardTitle('') }}排行榜
            </h3>
            <!-- 列选择器按钮 -->
            <div class="relative">
              <button
                @click.stop="showColumnSelector = !showColumnSelector"
                class="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <i class="fas fa-cog"></i>
                列设置
              </button>
              <!-- 列选择器下拉菜单 -->
              <div
                v-if="showColumnSelector"
                class="column-selector absolute right-0 z-10 mt-2 w-48 rounded-lg bg-white p-4 shadow-lg ring-1 ring-black ring-opacity-5"
              >
                <div class="mb-2 text-sm font-medium text-gray-900">显示列</div>
                <div class="space-y-2">
                  <label class="flex items-center">
                    <input
                      type="checkbox"
                      v-model="visibleColumns.rank"
                      class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span class="ml-2 text-sm text-gray-700">排名</span>
                  </label>
                  <label class="flex items-center">
                    <input
                      type="checkbox"
                      v-model="visibleColumns.userName"
                      class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span class="ml-2 text-sm text-gray-700">用户名</span>
                  </label>
                  <label class="flex items-center">
                    <input
                      type="checkbox"
                      v-model="visibleColumns.totalEditedLines"
                      class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span class="ml-2 text-sm text-gray-700">编辑行数</span>
                  </label>
                  <label class="flex items-center">
                    <input
                      type="checkbox"
                      v-model="visibleColumns.totalTestLines"
                      class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span class="ml-2 text-sm text-gray-700">单测行数</span>
                  </label>
                  <label class="flex items-center">
                    <input
                      type="checkbox"
                      v-model="visibleColumns.totalNewFiles"
                      class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span class="ml-2 text-sm text-gray-700">新建文件次数</span>
                  </label>
                  <label class="flex items-center">
                    <input
                      type="checkbox"
                      v-model="visibleColumns.totalModifiedFiles"
                      class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span class="ml-2 text-sm text-gray-700">修改文件次数</span>
                  </label>
                  <label class="flex items-center">
                    <input
                      type="checkbox"
                      v-model="visibleColumns.totalRequests"
                      class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span class="ml-2 text-sm text-gray-700">请求数</span>
                  </label>
                  <label class="flex items-center">
                    <input
                      type="checkbox"
                      v-model="visibleColumns.totalCost"
                      class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span class="ml-2 text-sm text-gray-700">费用</span>
                  </label>
                  <label class="flex items-center" v-if="overviewTimePeriod !== 'today'">
                    <input
                      type="checkbox"
                      v-model="visibleColumns.activeDays"
                      class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span class="ml-2 text-sm text-gray-700">活跃天数</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
          <div class="overflow-hidden rounded-lg border border-gray-200">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th
                    v-if="visibleColumns.rank"
                    class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    排名
                  </th>
                  <th
                    v-if="visibleColumns.userName"
                    class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    用户名
                  </th>
                  <th
                    v-if="visibleColumns.totalEditedLines"
                    class="cursor-pointer px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 hover:bg-gray-100"
                    @click="sortLeaderboard('totalEditedLines')"
                  >
                    <div class="flex items-center">
                      编辑行数
                      <span class="ml-1">
                        <i
                          v-if="leaderboardSortBy === 'totalEditedLines'"
                          :class="
                            leaderboardSortOrder === 'desc'
                              ? 'fas fa-chevron-down'
                              : 'fas fa-chevron-up'
                          "
                          class="text-xs text-blue-500"
                        ></i>
                        <i v-else class="fas fa-sort text-xs text-gray-400"></i>
                      </span>
                    </div>
                  </th>
                  <th
                    v-if="visibleColumns.totalTestLines"
                    class="cursor-pointer px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 hover:bg-gray-100"
                    @click="sortLeaderboard('totalTestLines')"
                  >
                    <div class="flex items-center">
                      单测行数
                      <span class="ml-1">
                        <i
                          v-if="leaderboardSortBy === 'totalTestLines'"
                          :class="
                            leaderboardSortOrder === 'desc'
                              ? 'fas fa-chevron-down'
                              : 'fas fa-chevron-up'
                          "
                          class="text-xs text-blue-500"
                        ></i>
                        <i v-else class="fas fa-sort text-xs text-gray-400"></i>
                      </span>
                    </div>
                  </th>
                  <th
                    v-if="visibleColumns.totalNewFiles"
                    class="cursor-pointer px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 hover:bg-gray-100"
                    @click="sortLeaderboard('totalNewFiles')"
                  >
                    <div class="flex items-center">
                      新建文件次数
                      <span class="ml-1">
                        <i
                          v-if="leaderboardSortBy === 'totalNewFiles'"
                          :class="
                            leaderboardSortOrder === 'desc'
                              ? 'fas fa-chevron-down'
                              : 'fas fa-chevron-up'
                          "
                          class="text-xs text-blue-500"
                        ></i>
                        <i v-else class="fas fa-sort text-xs text-gray-400"></i>
                      </span>
                    </div>
                  </th>
                  <th
                    v-if="visibleColumns.totalModifiedFiles"
                    class="cursor-pointer px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 hover:bg-gray-100"
                    @click="sortLeaderboard('totalModifiedFiles')"
                  >
                    <div class="flex items-center">
                      修改文件次数
                      <span class="ml-1">
                        <i
                          v-if="leaderboardSortBy === 'totalModifiedFiles'"
                          :class="
                            leaderboardSortOrder === 'desc'
                              ? 'fas fa-chevron-down'
                              : 'fas fa-chevron-up'
                          "
                          class="text-xs text-blue-500"
                        ></i>
                        <i v-else class="fas fa-sort text-xs text-gray-400"></i>
                      </span>
                    </div>
                  </th>
                  <th
                    v-if="visibleColumns.totalRequests"
                    class="cursor-pointer px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 hover:bg-gray-100"
                    @click="sortLeaderboard('totalRequests')"
                  >
                    <div class="flex items-center">
                      请求数
                      <span class="ml-1">
                        <i
                          v-if="leaderboardSortBy === 'totalRequests'"
                          :class="
                            leaderboardSortOrder === 'desc'
                              ? 'fas fa-chevron-down'
                              : 'fas fa-chevron-up'
                          "
                          class="text-xs text-blue-500"
                        ></i>
                        <i v-else class="fas fa-sort text-xs text-gray-400"></i>
                      </span>
                    </div>
                  </th>
                  <th
                    v-if="visibleColumns.totalCost"
                    class="cursor-pointer px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 hover:bg-gray-100"
                    @click="sortLeaderboard('totalCost')"
                  >
                    <div class="flex items-center">
                      费用
                      <span class="ml-1">
                        <i
                          v-if="leaderboardSortBy === 'totalCost'"
                          :class="
                            leaderboardSortOrder === 'desc'
                              ? 'fas fa-chevron-down'
                              : 'fas fa-chevron-up'
                          "
                          class="text-xs text-blue-500"
                        ></i>
                        <i v-else class="fas fa-sort text-xs text-gray-400"></i>
                      </span>
                    </div>
                  </th>
                  <!-- 活跃天数列（仅非当天显示） -->
                  <th
                    v-if="overviewTimePeriod !== 'today' && visibleColumns.activeDays"
                    class="cursor-pointer px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 hover:bg-gray-100"
                    @click="sortLeaderboard('activeDays')"
                  >
                    <div class="flex items-center">
                      活跃天数
                      <span class="ml-1">
                        <i
                          v-if="leaderboardSortBy === 'activeDays'"
                          :class="
                            leaderboardSortOrder === 'desc'
                              ? 'fas fa-chevron-down'
                              : 'fas fa-chevron-up'
                          "
                          class="text-xs text-blue-500"
                        ></i>
                        <i v-else class="fas fa-sort text-xs text-gray-400"></i>
                      </span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 bg-white">
                <tr v-for="(user, index) in paginatedLeaderboard" :key="user.keyId">
                  <td
                    v-if="visibleColumns.rank"
                    class="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900"
                  >
                    <span
                      class="inline-flex h-8 w-8 items-center justify-center rounded-full"
                      :class="getRankClass(index + (leaderboardPage - 1) * leaderboardPageSize)"
                    >
                      {{ index + 1 + (leaderboardPage - 1) * leaderboardPageSize }}
                    </span>
                  </td>
                  <td
                    v-if="visibleColumns.userName"
                    class="whitespace-nowrap px-6 py-4 text-sm text-gray-900"
                  >
                    {{ user.userName }}
                  </td>
                  <td
                    v-if="visibleColumns.totalEditedLines"
                    class="whitespace-nowrap px-6 py-4 text-sm text-gray-900"
                  >
                    {{ user.totalEditedLines }}
                  </td>
                  <td
                    v-if="visibleColumns.totalTestLines"
                    class="whitespace-nowrap px-6 py-4 text-sm text-gray-900"
                  >
                    {{ user.totalTestLines || 0 }}
                  </td>
                  <td
                    v-if="visibleColumns.totalNewFiles"
                    class="whitespace-nowrap px-6 py-4 text-sm text-gray-900"
                  >
                    {{ user.totalNewFiles }}
                  </td>
                  <td
                    v-if="visibleColumns.totalModifiedFiles"
                    class="whitespace-nowrap px-6 py-4 text-sm text-gray-900"
                  >
                    {{ user.totalModifiedFiles }}
                  </td>
                  <td
                    v-if="visibleColumns.totalRequests"
                    class="whitespace-nowrap px-6 py-4 text-sm text-gray-900"
                  >
                    {{ formatNumber(user.totalRequests || 0) }}
                  </td>
                  <td
                    v-if="visibleColumns.totalCost"
                    class="whitespace-nowrap px-6 py-4 text-sm text-gray-900"
                  >
                    ${{ (user.totalCost || 0).toFixed(4) }}
                  </td>
                  <!-- 活跃天数列（仅非当天显示） -->
                  <td
                    v-if="overviewTimePeriod !== 'today' && visibleColumns.activeDays"
                    class="whitespace-nowrap px-6 py-4 text-sm text-gray-900"
                  >
                    {{ user.activeDays || 0 }} 天
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 分页控件 -->
          <div
            v-if="leaderboardTotalPages > 1 || leaderboardTotalCount > 10"
            class="mt-4 flex items-center justify-between border-t border-gray-200 px-6 py-3"
          >
            <div class="flex flex-1 items-center justify-between">
              <!-- 每页条数选择器 -->
              <div class="flex items-center gap-2">
                <span class="text-sm text-gray-700">每页显示:</span>
                <select
                  v-model="leaderboardPageSize"
                  @change="changeLeaderboardPageSize"
                  class="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option :value="10">10 条</option>
                  <option :value="20">20 条</option>
                  <option :value="100">100 条</option>
                </select>
              </div>

              <!-- 分页信息和控件 -->
              <div class="flex items-center gap-4">
                <div class="hidden sm:block">
                  <p class="text-sm text-gray-700">
                    显示
                    <span class="font-medium">{{
                      (leaderboardPage - 1) * leaderboardPageSize + 1
                    }}</span>
                    到
                    <span class="font-medium">{{
                      Math.min(leaderboardPage * leaderboardPageSize, leaderboardTotalCount)
                    }}</span>
                    项，共
                    <span class="font-medium">{{ leaderboardTotalCount }}</span>
                    项
                  </p>
                </div>

                <div v-if="leaderboardTotalPages > 1">
                  <nav
                    class="isolate inline-flex -space-x-px rounded-md shadow-sm"
                    aria-label="分页"
                  >
                    <button
                      @click="leaderboardPrevPage"
                      :disabled="!leaderboardHasPrevPage"
                      :class="[
                        'relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0',
                        leaderboardHasPrevPage ? 'hover:text-gray-500' : 'cursor-not-allowed'
                      ]"
                    >
                      <span class="sr-only">上一页</span>
                      <i class="fas fa-chevron-left h-5 w-5" aria-hidden="true"></i>
                    </button>

                    <!-- 页码按钮 -->
                    <template v-for="page in getLeaderboardPageNumbers()" :key="page">
                      <button
                        v-if="page !== '...'"
                        @click="goToLeaderboardPage(page)"
                        :class="[
                          'relative inline-flex items-center px-4 py-2 text-sm font-semibold ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0',
                          page === leaderboardPage
                            ? 'z-10 bg-blue-600 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600'
                            : 'text-gray-900'
                        ]"
                      >
                        {{ page }}
                      </button>
                      <span
                        v-else
                        class="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-700 ring-1 ring-inset ring-gray-300"
                      >
                        ...
                      </span>
                    </template>

                    <button
                      @click="leaderboardNextPage"
                      :disabled="!leaderboardHasNextPage"
                      :class="[
                        'relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0',
                        leaderboardHasNextPage ? 'hover:text-gray-500' : 'cursor-not-allowed'
                      ]"
                    >
                      <span class="sr-only">下一页</span>
                      <i class="fas fa-chevron-right h-5 w-5" aria-hidden="true"></i>
                    </button>
                  </nav>
                </div>
              </div>
            </div>

            <!-- 移动端分页 -->
            <div class="flex flex-1 justify-between sm:hidden">
              <button
                @click="leaderboardPrevPage"
                :disabled="!leaderboardHasPrevPage"
                :class="[
                  'relative inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium',
                  leaderboardHasPrevPage
                    ? 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    : 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
                ]"
              >
                上一页
              </button>
              <button
                @click="leaderboardNextPage"
                :disabled="!leaderboardHasNextPage"
                :class="[
                  'relative ml-3 inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium',
                  leaderboardHasNextPage
                    ? 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    : 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
                ]"
              >
                下一页
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 工具调用统计模块 -->
      <div v-if="activeTab === 'tools'">
        <!-- 时间段选择器 -->
        <div class="mb-6 flex justify-end">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-gray-700">统计时间段：</span>
            <div class="flex rounded-lg border border-gray-200 bg-white">
              <button
                v-for="option in timePeriodOptions"
                :key="option.value"
                @click="changeToolsTimePeriod(option.value)"
                :class="[
                  'px-3 py-1.5 text-sm font-medium transition-all duration-200 first:rounded-l-lg last:rounded-r-lg',
                  toolsTimePeriod === option.value
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                ]"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
        </div>

        <!-- 工具调用统计卡片 -->
        <div class="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          <StatCard
            color="bg-indigo-500"
            icon="🔧"
            :title="getToolsCardTitle('工具调用')"
            :value="toolStats?.periodToolCalls || 0"
          />
          <StatCard
            color="bg-teal-500"
            icon="⚙️"
            title="工具种类"
            :value="
              Object.keys(toolStats?.tools || {}).filter(
                (tool) => tool !== 'Unknown' && tool !== 'undefined'
              ).length
            "
          />
          <StatCard color="bg-pink-500" icon="🏆" title="最常用工具" :value="getMostUsedTool()" />
        </div>

        <!-- 工具调用图表 -->
        <div class="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <!-- 工具调用趋势图 -->
          <div class="rounded-lg bg-white p-6 shadow-lg">
            <h3 class="mb-4 text-lg font-semibold text-gray-900">📈 工具调用趋势</h3>
            <div class="relative h-64 w-full">
              <canvas ref="toolTrendChart" class="absolute inset-0 h-full w-full"></canvas>
            </div>
          </div>

          <!-- 工具分布图 -->
          <div class="rounded-lg bg-white p-6 shadow-lg">
            <h3 class="mb-4 text-lg font-semibold text-gray-900">🔧 工具使用分布</h3>
            <div class="relative h-64 w-full">
              <canvas ref="toolDistributionChart" class="absolute inset-0 h-full w-full"></canvas>
            </div>
          </div>
        </div>

        <!-- 工具排行榜 -->
        <div class="rounded-lg bg-white p-6 shadow-lg">
          <h3 class="mb-4 text-lg font-semibold text-gray-900">
            🏆 {{ getToolsCardTitle('') }}工具使用排行榜 (Top 10)
          </h3>
          <div class="overflow-hidden rounded-lg border border-gray-200">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th
                    class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    排名
                  </th>
                  <th
                    class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    工具名称
                  </th>
                  <th
                    class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    总调用数
                  </th>
                  <th
                    class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    使用用户数
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 bg-white">
                <tr v-for="(tool, index) in toolRanking" :key="tool.tool">
                  <td class="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                    <span
                      class="inline-flex h-8 w-8 items-center justify-center rounded-full"
                      :class="getRankClass(index)"
                    >
                      {{ index + 1 }}
                    </span>
                  </td>
                  <td class="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                    <span class="inline-flex items-center gap-2">
                      {{ getToolIcon(tool.tool) }} {{ tool.tool }}
                    </span>
                  </td>
                  <td class="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                    {{ tool.totalCount }}
                  </td>
                  <td class="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                    {{ tool.totalUsers }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, computed, watch } from 'vue'
import { Chart, registerables } from 'chart.js'
import StatCard from '@/components/common/StatCard.vue'
import { showToast } from '@/utils/toast'

Chart.register(...registerables)

// 响应式数据
const loading = ref(true)
const activeTab = ref('overview')
const systemStats = ref(null)
const leaderboard = ref([])
const languageStats = ref({})
const trendData = ref([])

// 列显示控制
const visibleColumns = ref({
  rank: true,
  userName: true,
  totalEditedLines: true,
  totalTestLines: true,
  totalNewFiles: true,
  totalModifiedFiles: true,
  totalRequests: true,
  totalCost: true,
  activeDays: true
})
const showColumnSelector = ref(false)

// 工具统计数据
const toolStats = ref({})
const toolRanking = ref([])
const toolTrendData = ref([])

// 仪表盘数据（用于今日请求数和Token）
const dashboardOverview = ref({
  todayRequests: 0,
  todayInputTokens: 0,
  todayOutputTokens: 0,
  todayCacheCreateTokens: 0,
  todayCacheReadTokens: 0
})

// 活跃人数数据
const activeUsersCount = ref(0)

// 时间段相关
const overviewTimePeriod = ref('today') // 默认今天
const toolsTimePeriod = ref('today') // 默认今天

// 时间段选项
const timePeriodOptions = [
  { value: 'today', label: '当天' },
  { value: '7', label: '近7天' },
  { value: 'month', label: '当月' },
  { value: '30', label: '近30天' }
]

// 排行榜分页和排序相关
const leaderboardPage = ref(1)
const leaderboardPageSize = ref(10)
const leaderboardSortBy = ref('totalEditedLines') // 默认按编辑行数排序
const leaderboardSortOrder = ref('desc') // 降序
const leaderboardTotalCount = ref(0) // 总记录数
const leaderboardTotalPagesComputed = ref(0) // 总页数

// 排行榜相关计算属性 - 由于后端已经处理分页和排序，前端直接使用数据
const sortedLeaderboard = computed(() => {
  // 后端已经处理排序和分页，直接返回数据
  return leaderboard.value
})

const paginatedLeaderboard = computed(() => {
  // 后端已经处理分页，直接返回数据
  return leaderboard.value
})

const leaderboardTotalPages = computed(() => {
  return (
    leaderboardTotalPagesComputed.value ||
    Math.ceil(leaderboardTotalCount.value / leaderboardPageSize.value)
  )
})

const leaderboardHasPrevPage = computed(() => leaderboardPage.value > 1)
const leaderboardHasNextPage = computed(() => leaderboardPage.value < leaderboardTotalPages.value)

// 图表引用
const trendChart = ref(null)
const languageChart = ref(null)
const toolTrendChart = ref(null)
const toolDistributionChart = ref(null)

// Chart.js 实例
let trendChartInstance = null
let languageChartInstance = null
let toolTrendChartInstance = null
let toolDistributionChartInstance = null

// 获取系统统计数据
async function fetchSystemStats() {
  try {
    const daysParam = getDaysParam(overviewTimePeriod.value)
    const response = await fetch(`/admin/code-stats/system?${daysParam}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`
      }
    })
    if (!response.ok) {
      throw new Error('Failed to fetch system stats')
    }
    const data = await response.json()
    if (data.success) {
      systemStats.value = processSystemStats(data.data)
      trendData.value = data.data.daily || []
    }
  } catch (error) {
    console.error('Error fetching system stats:', error)
    showToast('获取系统统计失败', 'error')
  }
}

// 获取排行榜数据
async function fetchLeaderboard() {
  try {
    const daysParam = getDaysParam(overviewTimePeriod.value)
    const pageParam = `page=${leaderboardPage.value}&limit=${leaderboardPageSize.value}`
    const sortParam = `sortBy=${leaderboardSortBy.value}&sortOrder=${leaderboardSortOrder.value}`
    const response = await fetch(
      `/admin/code-stats/leaderboard?${daysParam}&${pageParam}&${sortParam}`,
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`
        }
      }
    )
    if (!response.ok) {
      throw new Error('Failed to fetch leaderboard')
    }
    const data = await response.json()
    if (data.success) {
      leaderboard.value = data.data || []
      // 更新分页信息
      if (data.pagination) {
        leaderboardTotalCount.value = data.pagination.total
        leaderboardTotalPagesComputed.value = data.pagination.totalPages
      }
    }
  } catch (error) {
    console.error('Error fetching leaderboard:', error)
    showToast('获取排行榜失败', 'error')
  }
}

// 获取语言统计数据
async function fetchLanguageStats() {
  try {
    const daysParam = getDaysParam(overviewTimePeriod.value)
    const response = await fetch(`/admin/code-stats/languages?${daysParam}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`
      }
    })
    if (!response.ok) {
      throw new Error('Failed to fetch language stats')
    }
    const data = await response.json()
    if (data.success) {
      languageStats.value = data.data || {}
    }
  } catch (error) {
    console.error('Error fetching language stats:', error)
    showToast('获取语言统计失败', 'error')
  }
}

// 获取工具统计数据
async function fetchToolStats() {
  try {
    const daysParam = getDaysParam(toolsTimePeriod.value)
    const response = await fetch(`/admin/code-stats/tools?${daysParam}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`
      }
    })
    if (!response.ok) {
      throw new Error('Failed to fetch tool stats')
    }
    const data = await response.json()
    if (data.success) {
      toolStats.value = processToolStats(data.data)
      toolTrendData.value = data.data.daily || []
    }
  } catch (error) {
    console.error('Error fetching tool stats:', error)
    showToast('获取工具统计失败', 'error')
  }
}

// 获取工具排行榜
async function fetchToolRanking() {
  try {
    const daysParam = getDaysParam(toolsTimePeriod.value)
    const response = await fetch(`/admin/code-stats/tools/ranking?limit=10&${daysParam}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`
      }
    })
    if (!response.ok) {
      throw new Error('Failed to fetch tool ranking')
    }
    const data = await response.json()
    if (data.success) {
      toolRanking.value = data.data || []
    }
  } catch (error) {
    console.error('Error fetching tool ranking:', error)
    showToast('获取工具排行榜失败', 'error')
  }
}

// 获取活跃人数统计
async function fetchActiveUsers() {
  try {
    const daysParam = getDaysParam(overviewTimePeriod.value)
    const response = await fetch(`/admin/code-stats/active-users?${daysParam}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`
      }
    })
    if (!response.ok) {
      throw new Error('Failed to fetch active users')
    }
    const data = await response.json()
    if (data.success) {
      activeUsersCount.value = data.data?.activeUsers || 0
    }
  } catch (error) {
    console.error('Error fetching active users:', error)
    showToast('获取活跃人数失败', 'error')
  }
}

// 获取使用统计数据（请求数和Token）
async function fetchUsageCosts() {
  try {
    let period = 'today' // 默认值

    // 将时间段参数转换为API期望的格式
    switch (overviewTimePeriod.value) {
      case 'today':
        period = 'today'
        break
      case '7':
        period = '7days'
        break
      case 'month':
        period = 'monthly'
        break
      case '30':
        period = '30days'
        break
      default:
        period = 'today'
    }

    const response = await fetch(`/admin/usage-costs?period=${period}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`
      }
    })
    if (!response.ok) {
      throw new Error('Failed to fetch usage costs')
    }
    const data = await response.json()
    if (data.success) {
      // 计算总请求数和总Token数
      let totalRequests = 0
      let totalTokens = 0
      let inputTokens = 0
      let outputTokens = 0
      let cacheCreateTokens = 0
      let cacheReadTokens = 0

      if (data.data.modelCosts && Array.isArray(data.data.modelCosts)) {
        data.data.modelCosts.forEach((model) => {
          // 对于请求数，如果是0但有token使用，就估算一个请求数
          const modelRequests = model.requests || 0
          const usage = model.usage || {}
          const hasUsage = (usage.input_tokens || 0) > 0 || (usage.output_tokens || 0) > 0

          // 如果没有请求数但有使用量，根据token数量估算请求数
          if (modelRequests === 0 && hasUsage) {
            // 根据平均token数估算请求数（假设每个请求平均1000-2000 token）
            const totalModelTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0)
            totalRequests += Math.max(1, Math.ceil(totalModelTokens / 1500))
          } else {
            totalRequests += modelRequests
          }

          inputTokens += usage.input_tokens || 0
          outputTokens += usage.output_tokens || 0
          cacheCreateTokens += usage.cache_creation_input_tokens || 0
          cacheReadTokens += usage.cache_read_input_tokens || 0
        })
      }

      totalTokens = inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens

      dashboardOverview.value = {
        todayRequests: totalRequests,
        todayTokens: totalTokens,
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        cacheCreateTokens: cacheCreateTokens,
        cacheReadTokens: cacheReadTokens,
        totalCost: data.data.totalCosts?.formatted?.totalCost || '$0.00'
      }
    }
  } catch (error) {
    console.error('Error fetching usage costs:', error)
    showToast('获取使用统计失败', 'error')
  }
}

// 获取时间段参数
function getDaysParam(period) {
  switch (period) {
    case 'today':
      return 'days=1'
    case '7':
      return 'days=7'
    case 'month':
      return 'month=current'
    case '30':
      return 'days=30'
    case 'all':
      return 'all=true'
    default:
      return 'days=7'
  }
}

// 时间段切换 - 全局统计概览
async function changeOverviewTimePeriod(period) {
  overviewTimePeriod.value = period
  showToast('正在切换时间段...', 'info')

  try {
    await Promise.all([
      fetchSystemStats(),
      fetchLanguageStats(),
      fetchLeaderboard(), // 添加排行榜数据刷新
      fetchUsageCosts(), // 添加使用统计数据刷新，实现时间段联动
      fetchActiveUsers() // 添加活跃人数数据刷新
    ])

    await nextTick()
    createTrendChart()
    createLanguageChart()

    showToast('时间段切换成功！', 'success')
  } catch (error) {
    console.error('Error changing overview time period:', error)
    showToast('时间段切换失败', 'error')
  }
}

// 时间段切换 - 工具调用统计
async function changeToolsTimePeriod(period) {
  toolsTimePeriod.value = period
  showToast('正在切换时间段...', 'info')

  try {
    await Promise.all([fetchToolStats(), fetchToolRanking()])

    await nextTick()
    createToolTrendChart()
    createToolDistributionChart()

    showToast('时间段切换成功！', 'success')
  } catch (error) {
    console.error('Error changing tools time period:', error)
    showToast('时间段切换失败', 'error')
  }
}

// 获取卡片标题 - 全局统计概览
function getOverviewCardTitle(baseTitle) {
  const periodLabels = {
    today: '当天',
    7: '近7天',
    month: '当月',
    30: '近30天'
  }
  return `${periodLabels[overviewTimePeriod.value] || '当天'}${baseTitle}`
}

// 获取卡片标题 - 工具调用统计
function getToolsCardTitle(baseTitle) {
  const periodLabels = {
    today: '当天',
    7: '近7天',
    month: '当月',
    30: '近30天'
  }
  return `${periodLabels[toolsTimePeriod.value] || '当天'}${baseTitle}`
}

// 处理系统统计数据
function processSystemStats(data) {
  // 根据时间段计算统计数据
  let totalLines = 0
  let totalOperations = 0
  let totalNewFiles = 0
  let totalModifiedFiles = 0

  if (overviewTimePeriod.value === 'today') {
    // 当天：只获取今天的数据
    const today = new Date().toISOString().split('T')[0]
    const todayData = data.daily?.find((d) => d.date === today) || {}
    totalLines = parseInt(todayData.totalEditedLines || 0)
    totalOperations = parseInt(todayData.totalEditOperations || 0)
    totalNewFiles = parseInt(todayData.totalNewFiles || 0)
    totalModifiedFiles = parseInt(todayData.totalModifiedFiles || 0)
  } else if (overviewTimePeriod.value === 'all') {
    // 历史以来：累计所有数据
    if (data.daily && Array.isArray(data.daily)) {
      data.daily.forEach((day) => {
        totalLines += parseInt(day.totalEditedLines || 0)
        totalOperations += parseInt(day.totalEditOperations || 0)
        totalNewFiles += parseInt(day.totalNewFiles || 0)
        totalModifiedFiles += parseInt(day.totalModifiedFiles || 0)
      })
    }
  } else {
    // 其他时间段：累计指定时间段内的数据
    if (data.daily && Array.isArray(data.daily)) {
      data.daily.forEach((day) => {
        totalLines += parseInt(day.totalEditedLines || 0)
        totalOperations += parseInt(day.totalEditOperations || 0)
        totalNewFiles += parseInt(day.totalNewFiles || 0)
        totalModifiedFiles += parseInt(day.totalModifiedFiles || 0)
      })
    }
  }

  return {
    periodLines: totalLines,
    periodOperations: totalOperations,
    periodNewFiles: totalNewFiles,
    periodModifiedFiles: totalModifiedFiles
  }
}

// 处理工具统计数据
function processToolStats(data) {
  const processed = { ...data }

  // 计算指定时间段的工具调用数
  let periodToolCalls = 0
  if (toolsTimePeriod.value === 'today') {
    // 当天：只计算今天的数据
    const today = new Date().toISOString().split('T')[0]
    const todayData = data.daily?.[today] || {}
    Object.values(todayData).forEach((toolData) => {
      if (typeof toolData === 'object' && toolData !== null && toolData.count) {
        periodToolCalls += toolData.count
      }
    })
  } else if (toolsTimePeriod.value === 'all') {
    // 历史以来：使用总计数据
    Object.values(data.tools || {}).forEach((tool) => {
      if (tool.totalCount) {
        periodToolCalls += tool.totalCount
      }
    })
  } else {
    // 其他时间段：计算指定时间段内的调用数
    Object.values(data.daily || {}).forEach((dayData) => {
      Object.values(dayData).forEach((toolData) => {
        if (typeof toolData === 'object' && toolData !== null && toolData.count) {
          periodToolCalls += toolData.count
        }
      })
    })
  }

  processed.periodToolCalls = periodToolCalls
  return processed
}

// 处理系统统计数据 (旧方法，保留兼容性)
function processSystemStatsOld(data) {
  const today = new Date().toISOString().split('T')[0]
  const todayData = data.daily?.find((d) => d.date === today) || {}

  return {
    todayLines: parseInt(todayData.totalEditedLines || 0),
    todayOperations: parseInt(todayData.totalEditOperations || 0),
    todayNewFiles: parseInt(todayData.totalNewFiles || 0),
    todayModifiedFiles: parseInt(todayData.totalModifiedFiles || 0)
  }
}

// 创建趋势图表
function createTrendChart() {
  // 检查canvas元素是否存在且可见
  if (!trendChart.value || !trendChart.value.offsetParent) {
    return
  }

  if (trendChartInstance) {
    trendChartInstance.destroy()
  }

  const ctx = trendChart.value.getContext('2d')
  const dates = trendData.value.map((d) => d.date).reverse()
  const lines = trendData.value.map((d) => parseInt(d.totalEditedLines || 0)).reverse()
  const operations = trendData.value.map((d) => parseInt(d.totalEditOperations || 0)).reverse()

  trendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [
        {
          label: '编辑行数',
          data: lines,
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.1
        },
        {
          label: '操作次数',
          data: operations,
          borderColor: 'rgb(16, 185, 129)', // green
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          tension: 0.1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  })
}

// 创建语言分布图表
function createLanguageChart() {
  // 检查canvas元素是否存在且可见
  if (!languageChart.value || !languageChart.value.offsetParent) {
    return
  }

  if (languageChartInstance) {
    languageChartInstance.destroy()
  }

  const ctx = languageChart.value.getContext('2d')
  // 按行数从大到小排序
  const sortedLanguages = Object.entries(languageStats.value)
    .map(([lang, stat]) => ({ language: lang, lines: stat.lines || 0 }))
    .sort((a, b) => b.lines - a.lines)

  const languages = sortedLanguages.map((item) => item.language)
  const lines = sortedLanguages.map((item) => item.lines)

  const colors = [
    'rgb(59, 130, 246)', // blue
    'rgb(16, 185, 129)', // green
    'rgb(139, 92, 246)', // purple
    'rgb(245, 101, 101)', // red
    'rgb(251, 191, 36)', // yellow
    'rgb(168, 85, 247)', // violet
    'rgb(34, 197, 94)', // emerald
    'rgb(239, 68, 68)' // rose
  ]

  languageChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: languages,
      datasets: [
        {
          data: lines,
          backgroundColor: colors.slice(0, languages.length),
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right'
        }
      }
    }
  })
}

// 创建工具调用趋势图表
function createToolTrendChart() {
  if (!toolTrendChart.value || !toolTrendChart.value.offsetParent) {
    return
  }

  if (toolTrendChartInstance) {
    toolTrendChartInstance.destroy()
  }

  const ctx = toolTrendChart.value.getContext('2d')
  const dates = Object.keys(toolStats.value.daily || {}).reverse()
  const toolCounts = dates.map((date) => {
    const dayData = toolStats.value.daily[date] || {}
    return Object.values(dayData).reduce((sum, toolData) => {
      return sum + (toolData.count || 0)
    }, 0)
  })

  toolTrendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [
        {
          label: '工具调用次数',
          data: toolCounts,
          borderColor: 'rgb(168, 85, 247)', // purple
          backgroundColor: 'rgba(168, 85, 247, 0.1)',
          tension: 0.1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  })
}

// 创建工具分布图表
function createToolDistributionChart() {
  if (!toolDistributionChart.value || !toolDistributionChart.value.offsetParent) {
    return
  }

  if (toolDistributionChartInstance) {
    toolDistributionChartInstance.destroy()
  }

  const ctx = toolDistributionChart.value.getContext('2d')
  // 过滤掉 Unknown 和 undefined
  const allTools = toolStats.value.tools || {}
  const filteredTools = Object.fromEntries(
    Object.entries(allTools).filter(
      ([toolName]) => toolName !== 'Unknown' && toolName !== 'undefined'
    )
  )

  // 按调用次数从大到小排序
  const sortedTools = Object.entries(filteredTools)
    .map(([tool, data]) => ({ tool, count: data.totalCount || 0 }))
    .sort((a, b) => b.count - a.count)

  const tools = sortedTools.map((item) => item.tool)
  const counts = sortedTools.map((item) => item.count)

  const colors = [
    'rgb(59, 130, 246)', // blue
    'rgb(16, 185, 129)', // green
    'rgb(139, 92, 246)', // purple
    'rgb(245, 101, 101)', // red
    'rgb(251, 191, 36)', // yellow
    'rgb(168, 85, 247)', // violet
    'rgb(34, 197, 94)', // emerald
    'rgb(239, 68, 68)' // rose
  ]

  toolDistributionChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: tools,
      datasets: [
        {
          data: counts,
          backgroundColor: colors.slice(0, tools.length),
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right'
        }
      }
    }
  })
}

// 获取排名样式
function getRankClass(index) {
  if (index === 0) return 'bg-yellow-500 text-white' // 金牌
  if (index === 1) return 'bg-gray-400 text-white' // 银牌
  if (index === 2) return 'bg-yellow-600 text-white' // 铜牌
  return 'bg-gray-200 text-gray-700' // 其他
}

// 刷新数据
async function refreshData() {
  showToast('正在刷新统计数据...', 'info')
  await initializeData()

  // 刷新时需要重新渲染所有图表，确保隐藏的tab数据也能更新
  await nextTick()
  createTrendChart()
  createLanguageChart()
  createToolTrendChart()
  createToolDistributionChart()

  showToast('统计数据刷新成功！', 'success')
}

// 初始化数据
async function initializeData() {
  loading.value = true

  try {
    await Promise.all([
      fetchSystemStats(),
      fetchLeaderboard(),
      fetchLanguageStats(),
      fetchToolStats(),
      fetchToolRanking(),
      fetchUsageCosts(),
      fetchActiveUsers()
    ])

    // 等待DOM更新后创建当前tab的图表
    await nextTick()
    renderCurrentTabCharts()
  } catch (error) {
    console.error('Error initializing data:', error)
    showToast('初始化数据失败', 'error')
  } finally {
    loading.value = false
  }
}

// 排行榜分页控制函数
function goToLeaderboardPage(page) {
  if (page >= 1 && page <= leaderboardTotalPages.value) {
    leaderboardPage.value = page
    fetchLeaderboard()
  }
}

function leaderboardPrevPage() {
  if (leaderboardHasPrevPage.value) {
    leaderboardPage.value--
    fetchLeaderboard()
  }
}

function leaderboardNextPage() {
  if (leaderboardHasNextPage.value) {
    leaderboardPage.value++
    fetchLeaderboard()
  }
}

// 排行榜排序函数 - 现在需要重新请求数据
function sortLeaderboard(field) {
  if (leaderboardSortBy.value === field) {
    // 如果已经是当前排序字段，则切换排序顺序
    leaderboardSortOrder.value = leaderboardSortOrder.value === 'desc' ? 'asc' : 'desc'
  } else {
    // 切换到新的排序字段，默认降序
    leaderboardSortBy.value = field
    leaderboardSortOrder.value = 'desc'
  }
  // 重置到第一页并重新获取数据
  leaderboardPage.value = 1
  fetchLeaderboard()
}

// 排行榜每页条数变更
function changeLeaderboardPageSize() {
  leaderboardPage.value = 1 // 重置到第一页
  fetchLeaderboard() // 重新获取数据
}

// 获取排行榜页码列表
function getLeaderboardPageNumbers() {
  const total = leaderboardTotalPages.value
  const current = leaderboardPage.value
  const pages = []

  if (total <= 7) {
    // 总页数小于等于7，显示所有页码
    for (let i = 1; i <= total; i++) {
      pages.push(i)
    }
  } else {
    // 总页数大于7，智能显示页码
    if (current <= 4) {
      // 当前页在前4页
      for (let i = 1; i <= 5; i++) {
        pages.push(i)
      }
      pages.push('...')
      pages.push(total)
    } else if (current >= total - 3) {
      // 当前页在后4页
      pages.push(1)
      pages.push('...')
      for (let i = total - 4; i <= total; i++) {
        pages.push(i)
      }
    } else {
      // 当前页在中间
      pages.push(1)
      pages.push('...')
      for (let i = current - 1; i <= current + 1; i++) {
        pages.push(i)
      }
      pages.push('...')
      pages.push(total)
    }
  }

  return pages
}

// 获取最常用工具
function getMostUsedTool() {
  if (!toolStats.value.tools || Object.keys(toolStats.value.tools).length === 0) {
    return '-'
  }

  let maxTool = ''
  let maxCount = 0

  Object.entries(toolStats.value.tools).forEach(([tool, data]) => {
    // 过滤掉 Unknown 和 undefined
    if (tool !== 'Unknown' && tool !== 'undefined' && data.totalCount > maxCount) {
      maxCount = data.totalCount
      maxTool = tool
    }
  })

  return maxTool || '-'
}

// 获取日均调用数
function getAvgDailyCalls() {
  if (!toolStats.value.tools || Object.keys(toolStats.value.tools).length === 0) {
    return 0
  }

  // 过滤掉 Unknown 和 undefined 后计算总调用数
  const totalCalls = Object.entries(toolStats.value.tools)
    .filter(([toolName]) => toolName !== 'Unknown' && toolName !== 'undefined')
    .reduce((sum, [, tool]) => sum + (tool.totalCount || 0), 0)
  const days = 30 // 假设30天统计周期
  return Math.round((totalCalls / days) * 100) / 100
}

// 获取工具图标
function getToolIcon(toolName) {
  const icons = {
    Edit: '✏️',
    Write: '📝',
    Read: '📖',
    Bash: '💻',
    Grep: '🔍',
    Glob: '🌐',
    MultiEdit: '📑',
    NotebookEdit: '📓',
    LS: '📁',
    Task: '⚡',
    WebFetch: '🌍',
    TodoWrite: '✅'
  }
  return icons[toolName] || '🔧'
}

// 格式化数字
function formatNumber(num) {
  if (!num && num !== 0) return '0'
  return num.toLocaleString('zh-CN')
}

// 格式化Token显示（类似仪表盘页面）
function formatTokens(tokens) {
  if (!tokens || tokens === 0) return '0'

  if (tokens >= 1000000) {
    return (tokens / 1000000).toFixed(2) + 'M'
  } else if (tokens >= 1000) {
    return (tokens / 1000).toFixed(2) + 'K'
  } else {
    return tokens.toString()
  }
}

// 根据当前tab渲染相应图表
function renderCurrentTabCharts() {
  if (activeTab.value === 'overview') {
    createTrendChart()
    createLanguageChart()
  } else if (activeTab.value === 'tools') {
    createToolTrendChart()
    createToolDistributionChart()
  }
}

// 监听标签页切换，重新渲染图表
watch(activeTab, async (newTab) => {
  await nextTick()
  renderCurrentTabCharts()
})

// 点击外部关闭列选择器
function handleClickOutside(event) {
  // 如果点击的是按钮本身，不关闭下拉菜单
  if (event.target.closest('button')?.innerText?.includes('列设置')) {
    return
  }

  const selector = document.querySelector('.column-selector')
  if (selector && !selector.contains(event.target)) {
    showColumnSelector.value = false
  }
}

// 组件挂载
onMounted(() => {
  initializeData()
  document.addEventListener('click', handleClickOutside)
})

// 组件卸载
onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
/* 自定义样式已移至内联样式 */
</style>
