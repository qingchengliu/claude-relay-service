<template>
  <div>
    <!-- 页面标题和操作按钮 -->
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-gray-800 dark:text-gray-200">OpenAI Console 账户管理</h2>
      <button
        @click="showCreateModal = true"
        class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
      >
        <i class="fas fa-plus mr-2"></i>
        添加账户
      </button>
    </div>

    <!-- 账户列表 -->
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead class="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                账户名称
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                状态
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                认证类型
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                基础 URL
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                优先级
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                最后使用
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                操作
              </th>
            </tr>
          </thead>
          <tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-for="account in accounts" :key="account.id" class="hover:bg-gray-50 dark:hover:bg-gray-700">
              <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex items-center">
                  <div>
                    <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {{ account.name }}
                    </div>
                    <div v-if="account.description" class="text-sm text-gray-500 dark:text-gray-400">
                      {{ account.description }}
                    </div>
                  </div>
                </div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <span
                  :class="[
                    'px-2 inline-flex text-xs leading-5 font-semibold rounded-full',
                    account.status === 'active'
                      ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100'
                      : account.status === 'error'
                      ? 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-600 dark:text-gray-100'
                  ]"
                >
                  {{ account.status }}
                </span>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                {{ account.authType }}
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                {{ account.baseUrl }}
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                {{ account.priority }}
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                {{ formatDate(account.lastUsedAt) }}
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                <button
                  @click="testAccount(account)"
                  class="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 mr-3"
                  title="测试连接"
                >
                  <i class="fas fa-plug"></i>
                </button>
                <button
                  @click="editAccount(account)"
                  class="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 mr-3"
                  title="编辑"
                >
                  <i class="fas fa-edit"></i>
                </button>
                <button
                  @click="deleteAccount(account)"
                  class="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                  title="删除"
                >
                  <i class="fas fa-trash"></i>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 创建/编辑账户模态框 -->
    <div
      v-if="showCreateModal || showEditModal"
      class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50"
      @click.self="closeModal"
    >
      <div class="relative top-20 mx-auto p-5 border w-full max-w-2xl shadow-lg rounded-md bg-white dark:bg-gray-800">
        <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
          {{ showEditModal ? '编辑 OpenAI Console 账户' : '添加 OpenAI Console 账户' }}
        </h3>

        <form @submit.prevent="saveAccount">
          <!-- 基本信息 -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              账户名称 <span class="text-red-500">*</span>
            </label>
            <input
              v-model="formData.name"
              type="text"
              required
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
              placeholder="例如：Production API"
            />
          </div>

          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              描述
            </label>
            <textarea
              v-model="formData.description"
              rows="2"
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
              placeholder="可选的描述信息"
            ></textarea>
          </div>

          <!-- API 配置 -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              基础 URL
            </label>
            <input
              v-model="formData.baseUrl"
              type="url"
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
              placeholder="https://api.openai.com"
            />
          </div>

          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Responses 路径
            </label>
            <input
              v-model="formData.responsesPath"
              type="text"
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
              placeholder="/v1/responses"
            />
          </div>

          <!-- 认证配置 -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              认证类型
            </label>
            <select
              v-model="formData.authType"
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="Bearer">Bearer Token</option>
              <option value="x-api-key">X-API-Key</option>
            </select>
          </div>

          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              API Key <span class="text-red-500">*</span>
            </label>
            <input
              v-model="formData.apiKey"
              type="password"
              required
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
              placeholder="sk-..."
            />
          </div>

          <!-- 代理配置 -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              代理配置
            </label>
            <div class="space-y-2">
              <select
                v-model="formData.proxy.type"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="">不使用代理</option>
                <option value="http">HTTP 代理</option>
                <option value="socks5">SOCKS5 代理</option>
              </select>

              <div v-if="formData.proxy.type" class="grid grid-cols-2 gap-2">
                <input
                  v-model="formData.proxy.host"
                  type="text"
                  placeholder="代理主机"
                  class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
                />
                <input
                  v-model="formData.proxy.port"
                  type="number"
                  placeholder="端口"
                  class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
                />
                <input
                  v-model="formData.proxy.auth"
                  type="text"
                  placeholder="用户名:密码（可选）"
                  class="col-span-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
            </div>
          </div>

          <!-- 高级设置 -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              优先级
            </label>
            <input
              v-model.number="formData.priority"
              type="number"
              min="1"
              max="100"
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
              placeholder="50"
            />
          </div>

          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              支持的模型（每行一个）
            </label>
            <textarea
              v-model="supportedModelsText"
              rows="3"
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
              placeholder="gpt-4o&#10;gpt-5"
            ></textarea>
          </div>

          <!-- 按钮 -->
          <div class="flex justify-end space-x-2">
            <button
              type="button"
              @click="closeModal"
              class="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              class="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
            >
              {{ showEditModal ? '保存' : '创建' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, computed } from 'vue'
import axios from 'axios'
import { useToast } from 'vue-toastification'

export default {
  name: 'OpenAIConsoleAccounts',
  setup() {
    const toast = useToast()
    const accounts = ref([])
    const showCreateModal = ref(false)
    const showEditModal = ref(false)
    const currentAccount = ref(null)

    const formData = ref({
      name: '',
      description: '',
      baseUrl: 'https://api.openai.com',
      responsesPath: '/v1/responses',
      authType: 'Bearer',
      apiKey: '',
      proxy: {
        type: '',
        host: '',
        port: '',
        auth: ''
      },
      priority: 50,
      supportedModels: []
    })

    const supportedModelsText = computed({
      get: () => formData.value.supportedModels.join('\n'),
      set: (value) => {
        formData.value.supportedModels = value
          .split('\n')
          .map(s => s.trim())
          .filter(s => s)
      }
    })

    // 获取账户列表
    const fetchAccounts = async () => {
      try {
        const response = await axios.get('/admin/openai-console-accounts')
        accounts.value = response.data.data || []
      } catch (error) {
        toast.error('获取账户列表失败: ' + error.message)
      }
    }

    // 创建或更新账户
    const saveAccount = async () => {
      try {
        const data = {
          ...formData.value,
          proxy: formData.value.proxy.type ? formData.value.proxy : null
        }

        if (showEditModal.value && currentAccount.value) {
          await axios.put(`/admin/openai-console-accounts/${currentAccount.value.id}`, data)
          toast.success('账户更新成功')
        } else {
          await axios.post('/admin/openai-console-accounts', data)
          toast.success('账户创建成功')
        }

        closeModal()
        fetchAccounts()
      } catch (error) {
        toast.error('保存失败: ' + error.message)
      }
    }

    // 编辑账户
    const editAccount = (account) => {
      currentAccount.value = account
      formData.value = {
        name: account.name,
        description: account.description || '',
        baseUrl: account.baseUrl || 'https://api.openai.com',
        responsesPath: account.responsesPath || '/v1/responses',
        authType: account.authType || 'Bearer',
        apiKey: '', // 不显示已保存的密钥
        proxy: account.proxy || { type: '', host: '', port: '', auth: '' },
        priority: account.priority || 50,
        supportedModels: account.supportedModels || []
      }
      showEditModal.value = true
    }

    // 删除账户
    const deleteAccount = async (account) => {
      if (!confirm(`确定要删除账户 "${account.name}" 吗？`)) {
        return
      }

      try {
        await axios.delete(`/admin/openai-console-accounts/${account.id}`)
        toast.success('账户删除成功')
        fetchAccounts()
      } catch (error) {
        toast.error('删除失败: ' + error.message)
      }
    }

    // 测试账户连接
    const testAccount = async (account) => {
      try {
        const response = await axios.post(`/admin/openai-console-accounts/${account.id}/test`)
        if (response.data.success) {
          toast.success('连接测试成功')
        } else {
          toast.warning('连接测试失败: ' + response.data.data.message)
        }
      } catch (error) {
        toast.error('测试失败: ' + error.message)
      }
    }

    // 关闭模态框
    const closeModal = () => {
      showCreateModal.value = false
      showEditModal.value = false
      currentAccount.value = null
      formData.value = {
        name: '',
        description: '',
        baseUrl: 'https://api.openai.com',
        responsesPath: '/v1/responses',
        authType: 'Bearer',
        apiKey: '',
        proxy: {
          type: '',
          host: '',
          port: '',
          auth: ''
        },
        priority: 50,
        supportedModels: []
      }
    }

    // 格式化日期
    const formatDate = (dateStr) => {
      if (!dateStr) return '从未'
      return new Date(dateStr).toLocaleString()
    }

    onMounted(() => {
      fetchAccounts()
    })

    return {
      accounts,
      showCreateModal,
      showEditModal,
      formData,
      supportedModelsText,
      fetchAccounts,
      saveAccount,
      editAccount,
      deleteAccount,
      testAccount,
      closeModal,
      formatDate
    }
  }
}
</script>