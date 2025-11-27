#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
代码统计截图定时任务脚本
支持定时执行和立即执行模式
"""

import os
import sys
import json
import hashlib
import base64
import argparse
import requests
import schedule
import time
from datetime import datetime, timedelta
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException
from webdriver_manager.chrome import ChromeDriverManager
from dotenv import load_dotenv
import logging

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('screenshot_scheduler.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class CodeStatsScreenshotScheduler:
    def __init__(self):
        """初始化截图调度器"""
        load_dotenv()
        
        # 基本配置（支持环境变量覆盖）
        self.base_url = os.getenv('BASE_URL', "http://localhost:3000")
        self.login_url = f"{self.base_url}/web/auth/login"
        self.stats_url = f"{self.base_url}/admin-next/code-stats"  # 修正为正确的URL
        self.webhook_url = os.getenv('WEIXIN_WEBHOOK_URL')
        
        # 从环境变量读取管理员凭据
        self.admin_credentials = self._load_admin_credentials()
        
        # Chrome驱动配置
        self.driver = None
        self.auth_token = None
        
        # 浏览器预热标志
        self._browser_preheated = False
        self._preheated_driver = None
        
        if not self.webhook_url:
            raise ValueError("请在.env文件中配置WEIXIN_WEBHOOK_URL")
        
        logger.info(f"初始化完成 - 服务地址: {self.base_url}")
        
        # 在初始化时预热浏览器（异步）
        self._preheat_browser()
    
    def _load_admin_credentials(self):
        """从环境变量读取管理员凭据"""
        username = os.getenv('ADMIN_USERNAME')
        password = os.getenv('ADMIN_PASSWORD')
        
        if not username or not password:
            raise ValueError("请在环境变量中配置ADMIN_USERNAME和ADMIN_PASSWORD")
        
        return {
            'username': username,
            'password': password
        }
    
    def _preheat_browser(self):
        """预热浏览器实例"""
        try:
            import threading
            
            def preheat():
                try:
                    logger.info("开始预热浏览器...")
                    
                    # 判断是否在Docker环境中
                    is_docker = os.path.exists('/.dockerenv') or os.getenv('DOCKER_CONTAINER', False)
                    
                    # 获取Chrome配置
                    chrome_options = self._get_chrome_options(is_docker)
                    service = self._get_chrome_driver_service(is_docker)
                    
                    # 创建浏览器实例
                    self._preheated_driver = webdriver.Chrome(service=service, options=chrome_options)
                    self._preheated_driver.set_window_size(1920, 1080)
                    
                    # 访问一个简单页面来完全初始化
                    self._preheated_driver.get("data:text/html,<html><body>Browser preheated</body></html>")
                    
                    self._browser_preheated = True
                    logger.info("浏览器预热完成")
                    
                except Exception as e:
                    logger.warning(f"浏览器预热失败: {e}")
                    self._browser_preheated = False
                    if self._preheated_driver:
                        try:
                            self._preheated_driver.quit()
                        except:
                            pass
                        self._preheated_driver = None
            
            # 在后台线程中预热
            threading.Thread(target=preheat, daemon=True).start()
            
        except Exception as e:
            logger.warning(f"无法启动浏览器预热: {e}")
    
    def _get_chrome_options(self, is_docker):
        """获取Chrome配置选项"""
        chrome_options = Options()
        
        if is_docker:
            # Docker环境特殊配置
            chrome_options.add_argument('--headless=new')  # 使用新版headless模式
            chrome_options.add_argument('--no-sandbox')
            chrome_options.add_argument('--disable-dev-shm-usage')
            chrome_options.add_argument('--disable-gpu')
            chrome_options.add_argument('--disable-features=VizDisplayCompositor')
            chrome_options.add_argument('--disable-extensions')
            chrome_options.add_argument('--disable-plugins')
            # chrome_options.add_argument('--disable-images')  # 截图需要图片
            # chrome_options.add_argument('--disable-javascript')  # 截图需要JS交互
            chrome_options.add_argument('--disable-plugins-discovery')
            chrome_options.add_argument('--disable-preconnect')
            chrome_options.add_argument('--disable-background-timer-throttling')
            chrome_options.add_argument('--disable-backgrounding-occluded-windows')
            chrome_options.add_argument('--disable-renderer-backgrounding')
            chrome_options.add_argument('--disable-features=TranslateUI')
            chrome_options.add_argument('--disable-ipc-flooding-protection')
            chrome_options.add_argument('--no-first-run')
            chrome_options.add_argument('--no-default-browser-check')
            chrome_options.add_argument('--no-zygote')
            chrome_options.add_argument('--disable-default-apps')
            chrome_options.add_argument('--enable-logging')
            chrome_options.add_argument('--log-level=0')
            chrome_options.add_argument('--v=1')
            chrome_options.add_argument('--disable-background-mode')
            chrome_options.add_argument('--disable-background-networking')
            chrome_options.add_argument('--disable-client-side-phishing-detection')
            chrome_options.add_argument('--disable-sync')
            chrome_options.add_argument('--metrics-recording-only')
            chrome_options.add_argument('--no-report-upload')
            chrome_options.add_argument('--disable-crash-reporter')
            chrome_options.add_argument('--disable-hang-monitor')
            chrome_options.add_argument('--disable-prompt-on-repost')
            chrome_options.add_argument('--disable-web-resources')
            chrome_options.add_argument('--disable-component-update')
            chrome_options.add_argument('--disable-domain-reliability')
            # 移除可能导致问题的参数
            # chrome_options.add_argument('--single-process')  # 移除单进程模式
            # chrome_options.add_argument('--remote-debugging-port=9222')  # 移除调试端口
            
            # 设置Chrome二进制位置
            chrome_options.binary_location = '/usr/bin/google-chrome-stable'
        else:
            # 本地环境配置
            chrome_options.add_argument('--headless=new')  # 使用新版无头模式
            chrome_options.add_argument('--no-sandbox')
            chrome_options.add_argument('--disable-dev-shm-usage')
            chrome_options.add_argument('--disable-gpu')
            chrome_options.add_argument('--disable-features=VizDisplayCompositor')
            chrome_options.add_argument('--no-first-run')
        
        # 通用配置
        chrome_options.add_argument('--window-size=1920,1080')
        chrome_options.add_argument('--disable-web-security')
        chrome_options.add_argument('--force-device-scale-factor=1')  # 防止缩放问题
        
        # 字体配置
        chrome_options.add_argument('--font-render-hinting=none')
        chrome_options.add_argument('--disable-font-subpixel-positioning')
        chrome_options.add_argument('--lang=zh-CN')
        
        # 强制使用系统字体
        prefs = {
            "profile.default_content_settings.popups": 0,
            "profile.default_content_setting_values.notifications": 2,
            "webkit.webprefs.fonts.standard.Hans": "WenQuanYi Zen Hei",
            "webkit.webprefs.fonts.serif.Hans": "WenQuanYi Zen Hei", 
            "webkit.webprefs.fonts.sansserif.Hans": "WenQuanYi Zen Hei",
            "webkit.webprefs.fonts.fixed.Hans": "WenQuanYi Zen Hei Mono"
        }
        chrome_options.add_experimental_option("prefs", prefs)
        
        # Windows特殊处理
        import platform
        if platform.system() == 'Windows':
            chrome_options.add_argument('--disable-software-rasterizer')
        
        return chrome_options
    
    def _get_chrome_driver_service(self, is_docker):
        """获取Chrome驱动服务"""
        import socket
        
        # 设置网络超时
        socket.setdefaulttimeout(30)
        
        if is_docker:
            # Docker环境：优先使用预安装的ChromeDriver
            chrome_driver_paths = [
                '/usr/bin/chromedriver',
                '/usr/local/bin/chromedriver',
                '/opt/chrome/chromedriver'
            ]
            
            for driver_path in chrome_driver_paths:
                if os.path.exists(driver_path):
                    logger.info(f"使用预安装的ChromeDriver: {driver_path}")
                    return Service(driver_path)
            
            logger.info("未找到预安装的ChromeDriver，使用webdriver-manager")
        
        # 配置webdriver-manager缓存和超时
        cache_dir = "/app/.wdm" if is_docker else os.path.expanduser("~/.wdm")
        os.makedirs(cache_dir, exist_ok=True)
        
        try:
            driver_manager = ChromeDriverManager(
                cache_valid_range=30,  # 缓存有效期30天
                path=cache_dir
            )
            
            # 使用较短超时时间下载驱动
            import requests
            original_timeout = requests.adapters.DEFAULT_TIMEOUT
            requests.adapters.DEFAULT_TIMEOUT = 30
            
            try:
                driver_path = driver_manager.install()
                logger.info(f"ChromeDriver安装成功: {driver_path}")
                return Service(driver_path)
            finally:
                requests.adapters.DEFAULT_TIMEOUT = original_timeout
                
        except Exception as e:
            logger.warning(f"webdriver-manager失败: {e}")
            # 最后尝试系统PATH中的chromedriver
            return Service()
    
    def _setup_driver(self):
        """设置Chrome浏览器驱动"""
        try:
            # 优先使用预热的浏览器
            if self._browser_preheated and self._preheated_driver:
                logger.info("使用预热的浏览器实例")
                self.driver = self._preheated_driver
                self._preheated_driver = None  # 避免重复使用
                self._browser_preheated = False
                return
            
            logger.info("创建新的浏览器实例")
            
            # 判断是否在Docker环境中
            is_docker = os.path.exists('/.dockerenv') or os.getenv('DOCKER_CONTAINER', False)
            
            # 获取Chrome配置和服务
            chrome_options = self._get_chrome_options(is_docker)
            
            # 获取Chrome驱动服务
            try:
                service = self._get_chrome_driver_service(is_docker)
                self.driver = webdriver.Chrome(service=service, options=chrome_options)
            except Exception as e:
                logger.warning(f"使用Service失败: {e}，尝试直接初始化")
                self.driver = webdriver.Chrome(options=chrome_options)
            
            self.driver.set_window_size(1920, 1080)
            
            logger.info(f"Chrome驱动初始化成功 (Docker: {is_docker})")
            
        except Exception as e:
            logger.error(f"Chrome驱动初始化失败: {e}")
            logger.error("请确保Chrome浏览器已安装，或手动下载ChromeDriver放到系统PATH中")
            raise
    
    def _login(self):
        """登录获取认证令牌"""
        try:
            # 使用requests进行登录
            login_data = {
                'username': self.admin_credentials['username'],
                'password': self.admin_credentials['password']
            }
            
            response = requests.post(self.login_url, json=login_data, timeout=30)
            
            if response.status_code == 200:
                result = response.json()
                if result.get('success'):
                    self.auth_token = result.get('token')
                    logger.info("登录成功，获取到认证令牌")
                    return True
                else:
                    logger.error(f"登录失败: {result.get('message', '未知错误')}")
                    return False
            else:
                logger.error(f"登录请求失败，状态码: {response.status_code}")
                return False
                
        except Exception as e:
            logger.error(f"登录过程异常: {e}")
            return False
    
    def _take_screenshot(self, time_range='today'):
        """截取代码统计页面截图"""
        if not self.auth_token:
            logger.error("未获取到认证令牌，无法截图")
            return None
        
        try:
            # 访问代码统计页面
            self.driver.get(self.stats_url)
            
            # 设置Authorization header (通过localStorage)
            self.driver.execute_script(f"localStorage.setItem('authToken', '{self.auth_token}');")
            
            # 刷新页面以应用token
            self.driver.refresh()
            
            # 等待页面加载完成
            wait = WebDriverWait(self.driver, 30)
            
            # 等待左侧菜单加载完成
            time.sleep(3)
            
            # 查找并点击"代码统计"菜单项
            try:
                # 尝试多种可能的选择器
                code_stats_selectors = [
                    "//span[contains(text(), '代码统计')]",
                    "//div[contains(text(), '代码统计')]",
                    "//a[contains(text(), '代码统计')]",
                    "//button[contains(text(), '代码统计')]",
                    "//*[contains(@class, 'menu')]//span[contains(text(), '代码统计')]",
                    "//*[contains(@class, 'nav')]//span[contains(text(), '代码统计')]",
                    "//*[@role='menuitem' and contains(text(), '代码统计')]"
                ]
                
                code_stats_menu = None
                for selector in code_stats_selectors:
                    try:
                        code_stats_menu = wait.until(
                            EC.element_to_be_clickable((By.XPATH, selector))
                        )
                        if code_stats_menu:
                            logger.info(f"找到代码统计菜单项: {selector}")
                            break
                    except:
                        continue
                
                if code_stats_menu:
                    # 滚动到元素位置
                    self.driver.execute_script("arguments[0].scrollIntoView(true);", code_stats_menu)
                    time.sleep(1)
                    # 点击菜单项
                    code_stats_menu.click()
                    logger.info("成功点击代码统计菜单")
                    time.sleep(3)  # 等待页面加载
                else:
                    logger.warning("未找到代码统计菜单项，继续截图当前页面")
                    
            except Exception as e:
                logger.warning(f"点击代码统计菜单失败: {e}，继续截图当前页面")
            
            # 根据时间范围调整统计时间
            if time_range == 'week':
                try:
                    # 查找并点击时间范围选择器（假设有7天选项）
                    time_selector_options = [
                        "//button[contains(text(), '7天')]",
                        "//button[contains(text(), '近7天')]",
                        "//button[contains(text(), '最近7天')]",
                        "//span[contains(text(), '7天')]",
                        "//div[contains(text(), '7天')]",
                        "//*[@role='button' and contains(text(), '7天')]"
                    ]
                    
                    for selector in time_selector_options:
                        try:
                            time_selector = wait.until(
                                EC.element_to_be_clickable((By.XPATH, selector))
                            )
                            if time_selector:
                                time_selector.click()
                                logger.info("成功切换到7天统计")
                                time.sleep(2)  # 等待数据加载
                                break
                        except:
                            continue
                            
                except:
                    logger.warning("未找到7天时间选择器，使用默认时间范围")
            
            # 等待统计数据加载完成
            try:
                # 等待图表或数据表格加载
                wait.until(
                    EC.presence_of_element_located((By.CLASS_NAME, "chart-container"))
                )
            except:
                try:
                    # 尝试等待canvas元素（图表）
                    wait.until(
                        EC.presence_of_element_located((By.TAG_NAME, "canvas"))
                    )
                except:
                    try:
                        # 尝试等待数据表格
                        wait.until(
                            EC.presence_of_element_located((By.TAG_NAME, "table"))
                        )
                    except:
                        logger.warning("未找到预期的数据展示元素，继续截图")
            
            # 额外等待确保图表渲染完成
            time.sleep(5)
            
            # 查找tab-content元素，只截取内容区域
            try:
                # 尝试找到tab-content元素
                tab_content_element = None
                tab_content_selectors = [
                    (By.CLASS_NAME, "tab-content"),
                    (By.CLASS_NAME, "content-area"),
                    (By.CLASS_NAME, "main-content"),
                    (By.ID, "tab-content"),
                    (By.XPATH, "//div[@class='tab-content']"),
                    (By.XPATH, "//div[contains(@class, 'tab-content')]"),
                    (By.XPATH, "//main"),
                    (By.XPATH, "//div[contains(@class, 'content')]")
                ]
                
                for selector_type, selector_value in tab_content_selectors:
                    try:
                        tab_content_element = self.driver.find_element(selector_type, selector_value)
                        if tab_content_element:
                            logger.info(f"找到内容区域: {selector_value}")
                            break
                    except:
                        continue
                
                if tab_content_element:
                    # 获取元素的位置和尺寸
                    location = tab_content_element.location
                    size = tab_content_element.size
                    
                    # 滚动到元素顶部
                    self.driver.execute_script("arguments[0].scrollIntoView(true);", tab_content_element)
                    time.sleep(1)
                    
                    # 获取元素的完整高度（包括滚动内容）
                    element_height = self.driver.execute_script(
                        "return arguments[0].scrollHeight;", tab_content_element
                    )
                    element_width = size['width']
                    
                    # 尝试找到更精确的内容区域，减少左右留白
                    try:
                        # 优先查找mb-8类的元素（代码统计页面的主要内容区域）
                        primary_content_selectors = [
                            (By.XPATH, "//div[contains(@class, 'mb-8') and contains(@class, 'flex')]"),
                            (By.XPATH, "//div[contains(@class, 'mb-8')]"),
                            (By.XPATH, "//div[contains(@class, 'max-w-7xl')]"),
                            (By.CLASS_NAME, "mb-8"),
                        ]
                        
                        precise_element = None
                        for selector_type, selector_value in primary_content_selectors:
                            try:
                                elements = tab_content_element.find_elements(selector_type, selector_value)
                                # 选择第一个可见的mb-8元素
                                for elem in elements:
                                    if elem.is_displayed() and elem.size['width'] > 300:
                                        precise_element = elem
                                        logger.info(f"找到精确内容区域: {selector_value}")
                                        break
                                if precise_element:
                                    break
                            except:
                                continue
                        
                        if precise_element:
                            # 使用精确元素的尺寸
                            precise_size = precise_element.size
                            precise_location = precise_element.location_once_scrolled_into_view
                            
                            # 使用精确元素的宽度，加适当边距
                            element_width = precise_size['width'] + 40  # 减少边距
                            
                            # 滚动到精确元素
                            self.driver.execute_script("arguments[0].scrollIntoView(true);", precise_element)
                            time.sleep(1)
                            
                            logger.info(f"使用精确内容区域宽度: {element_width}px")
                        else:
                            # 如果没找到精确元素，使用原始逻辑但减少宽度
                            element_width = min(size['width'], 1200)  # 限制最大宽度
                            logger.info(f"未找到精确内容区域，使用限制宽度: {element_width}px")
                            
                    except Exception as e:
                        logger.debug(f"查找精确内容区域失败: {e}")
                        element_width = min(size['width'], 1200)  # 降级处理
                    
                    logger.info(f"最终内容区域尺寸: {element_width}x{element_height}px")
                    
                    # 设置窗口大小，减少额外宽度
                    self.driver.set_window_size(element_width + 50, element_height + 200)  # 减少左右边距从100到50
                    time.sleep(2)
                    
                    # 截取元素截图
                    screenshot = self._capture_element_screenshot(tab_content_element)
                else:
                    logger.warning("未找到tab-content元素，截取全页面")
                    # 如果找不到特定元素，回退到全页面截图
                    screenshot = self._capture_full_page()
                    
            except Exception as e:
                logger.warning(f"截取内容区域失败: {e}，使用全页面截图")
                screenshot = self._capture_full_page()
            
            # 生成文件名
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"code_stats_{time_range}_{timestamp}.png"
            
            logger.info(f"截图成功: {filename}")
            return screenshot, filename
            
        except TimeoutException:
            logger.error("页面加载超时")
            return None
        except WebDriverException as e:
            logger.error(f"浏览器异常: {e}")
            return None
        except Exception as e:
            logger.error(f"截图过程异常: {e}")
            return None
    
    def _capture_element_screenshot(self, element):
        """截取特定元素的截图"""
        try:
            # 方法1：使用元素的screenshot方法（Selenium 4+）
            try:
                return element.screenshot_as_png
            except:
                pass
            
            # 方法2：截取全屏然后裁剪
            from PIL import Image
            import io
            
            # 获取元素位置和大小
            location = element.location
            size = element.size
            
            # 截取全屏
            png = self.driver.get_screenshot_as_png()
            im = Image.open(io.BytesIO(png))
            
            # 计算裁剪区域
            left = location['x']
            top = location['y']
            right = location['x'] + size['width']
            bottom = location['y'] + size['height']
            
            # 裁剪图片
            im = im.crop((left, top, right, bottom))
            
            # 转换为字节
            output = io.BytesIO()
            im.save(output, format='PNG')
            return output.getvalue()
            
        except Exception as e:
            logger.error(f"元素截图失败: {e}")
            # 降级到全页面截图
            return self.driver.get_screenshot_as_png()
    
    def _capture_full_page(self):
        """截取全页面（原有逻辑）"""
        # 获取页面的完整高度
        total_height = self.driver.execute_script("return document.body.scrollHeight")
        viewport_height = self.driver.execute_script("return window.innerHeight")
        
        logger.info(f"页面高度: {total_height}px, 视窗高度: {viewport_height}px")
        
        # 设置窗口高度为页面的完整高度
        self.driver.set_window_size(1920, total_height)
        time.sleep(2)
        
        # 如果页面太长，分段截图并合并
        if total_height > 10000:
            logger.info(f"页面高度{total_height}px，使用滚动截图方式")
            return self._capture_full_page_screenshot()
        else:
            logger.info(f"页面高度{total_height}px，直接截取全页面")
            return self.driver.get_screenshot_as_png()
    
    def _capture_full_page_screenshot(self):
        """滚动页面并拼接截图（用于超长页面）"""
        try:
            from PIL import Image
            import io
            
            # 获取页面尺寸
            total_height = self.driver.execute_script("return document.body.scrollHeight")
            viewport_height = self.driver.execute_script("return window.innerHeight")
            viewport_width = self.driver.execute_script("return window.innerWidth")
            
            # 设置窗口大小
            self.driver.set_window_size(viewport_width, viewport_height)
            
            # 截图列表
            screenshots = []
            offset = 0
            
            while offset < total_height:
                # 滚动到指定位置
                self.driver.execute_script(f"window.scrollTo(0, {offset});")
                time.sleep(1)  # 等待页面渲染
                
                # 截图
                screenshot = self.driver.get_screenshot_as_png()
                screenshots.append(Image.open(io.BytesIO(screenshot)))
                
                # 更新偏移量
                offset += viewport_height
                
                # 如果是最后一部分，确保截到底部
                if offset >= total_height and offset - viewport_height < total_height:
                    self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                    time.sleep(1)
                    screenshot = self.driver.get_screenshot_as_png()
                    screenshots.append(Image.open(io.BytesIO(screenshot)))
                    break
            
            # 拼接图片
            if len(screenshots) == 1:
                final_image = screenshots[0]
            else:
                # 创建一个新的图片来存放拼接结果
                final_image = Image.new('RGB', (viewport_width, total_height))
                y_offset = 0
                
                for i, img in enumerate(screenshots):
                    if i == len(screenshots) - 1:
                        # 最后一张图片可能有重叠，需要裁剪
                        final_image.paste(img, (0, y_offset))
                    else:
                        final_image.paste(img, (0, y_offset))
                        y_offset += viewport_height
            
            # 转换为PNG字节
            output = io.BytesIO()
            final_image.save(output, format='PNG')
            return output.getvalue()
            
        except ImportError:
            logger.warning("PIL库未安装，使用默认截图方式")
            # 如果没有PIL库，退回到普通截图
            return self.driver.get_screenshot_as_png()
        except Exception as e:
            logger.error(f"滚动截图失败: {e}")
            # 出错时返回当前视图的截图
            return self.driver.get_screenshot_as_png()
    
    def _send_to_weixin(self, image_data, filename):
        """发送图片到企业微信机器人"""
        try:
            # 计算图片的base64和md5
            image_base64 = base64.b64encode(image_data).decode('utf-8')
            image_md5 = hashlib.md5(image_data).hexdigest()
            
            # 构建企业微信机器人消息
            message = {
                "msgtype": "image",
                "image": {
                    "base64": image_base64,
                    "md5": image_md5
                }
            }
            
            # 发送请求
            response = requests.post(self.webhook_url, json=message, timeout=30)
            
            if response.status_code == 200:
                result = response.json()
                if result.get('errcode') == 0:
                    logger.info(f"图片发送成功: {filename}")
                    return True
                else:
                    logger.error(f"企业微信返回错误: {result.get('errmsg', '未知错误')}")
                    return False
            else:
                logger.error(f"发送请求失败，状态码: {response.status_code}")
                return False
                
        except Exception as e:
            logger.error(f"发送图片异常: {e}")
            return False
    
    def _execute_task(self, time_range='today'):
        """执行截图和发送任务"""
        logger.info(f"开始执行截图任务，时间范围: {time_range}")
        
        try:
            # 设置浏览器驱动
            self._setup_driver()
            
            # 登录获取token
            if not self._login():
                return False
            
            # 截图
            result = self._take_screenshot(time_range)
            if not result:
                return False
            
            screenshot, filename = result
            
            # 发送到企业微信
            success = self._send_to_weixin(screenshot, filename)
            
            return success
            
        except Exception as e:
            logger.error(f"任务执行异常: {e}")
            return False
        finally:
            # 清理资源
            if self.driver:
                self.driver.quit()
                self.driver = None
    
    def run_once(self, time_range='today'):
        """立即执行一次任务"""
        logger.info("立即执行截图任务")
        return self._execute_task(time_range)
    
    def start_scheduler(self):
        """启动定时任务调度器"""
        logger.info("启动定时任务调度器")
        
        # 配置定时任务
        schedule.every().monday.at("21:30").do(self._execute_task, 'today')
        schedule.every().tuesday.at("21:30").do(self._execute_task, 'today')
        schedule.every().wednesday.at("21:30").do(self._execute_task, 'today')
        schedule.every().thursday.at("21:30").do(self._execute_task, 'today')

        schedule.every().friday.at("21:30").do(self._execute_task, 'week')  # 周五21:30生成周报
        
        logger.info("定时任务配置完成:")
        logger.info("- 周一到周四 21:30: 今日统计")
        logger.info("- 周五 21:30: 近7天统计")
        
        # 持续运行
        while True:
            try:
                schedule.run_pending()
                time.sleep(60)  # 每分钟检查一次
            except KeyboardInterrupt:
                logger.info("接收到中断信号，停止调度器")
                break
            except Exception as e:
                logger.error(f"调度器运行异常: {e}")
                time.sleep(60)  # 异常时等待1分钟后继续


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description='代码统计截图定时任务')
    parser.add_argument('--run-now', action='store_true', help='立即执行一次任务')
    parser.add_argument('--time-range', choices=['today', 'week'], default='today', 
                       help='时间范围: today(今日) 或 week(近7天)')
    parser.add_argument('--daemon', action='store_true', help='以守护进程模式运行定时任务')
    
    args = parser.parse_args()
    
    try:
        scheduler = CodeStatsScreenshotScheduler()
        
        if args.run_now:
            # 立即执行
            success = scheduler.run_once(args.time_range)
            sys.exit(0 if success else 1)
        else:
            # 启动定时任务
            scheduler.start_scheduler()
            
    except Exception as e:
        logger.error(f"程序启动失败: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()