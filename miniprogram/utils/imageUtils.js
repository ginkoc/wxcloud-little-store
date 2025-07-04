/**
 * 图片处理工具类 - 简化版本
 * 只包含图片压缩、上传、删除等实用功能
 */

class ImageUtils {

  /**
   * 压缩图片
   * @param {string} filePath - 图片文件路径
   * @param {number} quality - 压缩质量 (0-1)
   * @param {number} maxWidth - 最大宽度
   * @param {number} maxHeight - 最大高度
   * @returns {Promise<string>} - 压缩后的图片路径
   */
  compressImage(filePath, quality = 0.8, maxWidth = 800, maxHeight = 800) {
    return new Promise((resolve, reject) => {
      // 获取图片信息
      wx.getImageInfo({
        src: filePath,
        success: (res) => {
          const { width, height } = res;
          
          // 计算压缩后的尺寸
          let newWidth = width;
          let newHeight = height;
          
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            newWidth = Math.round(width * ratio);
            newHeight = Math.round(height * ratio);
          }
          
          // 如果尺寸没有变化且质量为1，直接返回原图
          if (newWidth === width && newHeight === height && quality >= 1) {
            resolve(filePath);
            return;
          }
          
          // 获取Canvas节点进行压缩
          const query = wx.createSelectorQuery();
          query.select('#imageCompressCanvas')
            .fields({ node: true, size: true })
            .exec((canvasRes) => {
              if (!canvasRes || !canvasRes[0] || !canvasRes[0].node) {
                console.warn('Canvas节点不可用，使用原图');
                resolve(filePath);
                return;
              }
              
              const canvas = canvasRes[0].node;
              const ctx = canvas.getContext('2d');
              
              // 设置Canvas尺寸
              canvas.width = newWidth;
              canvas.height = newHeight;
              
              // 创建图片对象
              const img = canvas.createImage();
              
              img.onload = () => {
                // 绘制压缩后的图片
                ctx.drawImage(img, 0, 0, newWidth, newHeight);
                
                // 导出图片
                wx.canvasToTempFilePath({
                  canvas: canvas,
                  quality: quality,
                  fileType: 'jpg',
                  success: (tempRes) => {
                    console.log(`图片压缩成功: ${width}x${height} -> ${newWidth}x${newHeight}`);
                    resolve(tempRes.tempFilePath);
                  },
                  fail: (err) => {
                    console.error('Canvas导出失败:', err);
                    resolve(filePath); // 失败时返回原图
                  }
                });
              };
              
              img.onerror = () => {
                console.error('图片加载失败');
                resolve(filePath); // 失败时返回原图
              };
              
              img.src = filePath;
            });
        },
        fail: (err) => {
          console.error('获取图片信息失败:', err);
          reject(new Error('图片无效'));
        }
      });
    });
  }

  /**
   * 上传图片到云存储（带重试功能）
   * @param {string} filePath - 本地文件路径
   * @param {string} cloudPath - 云存储路径
   * @param {function} onProgress - 进度回调
   * @param {number} maxRetries - 最大重试次数
   * @returns {Promise<object>} - 上传结果
   */
  uploadImageWithRetry(filePath, cloudPath, onProgress, maxRetries = 3) {
    return new Promise((resolve, reject) => {
      let retryCount = 0;
      
      const doUpload = () => {
        console.log(`开始上传图片 (第${retryCount + 1}次尝试): ${cloudPath}`);
        
        const uploadTask = wx.cloud.uploadFile({
          cloudPath: cloudPath,
          filePath: filePath,
          success: (res) => {
            console.log('图片上传成功:', res.fileID);
            resolve(res);
          },
          fail: (err) => {
            console.error(`第${retryCount + 1}次上传失败:`, err);
            
            retryCount++;
            if (retryCount < maxRetries) {
              console.log(`准备第${retryCount + 1}次重试...`);
              setTimeout(doUpload, 1000 * retryCount); // 递增延迟
            } else {
              reject(new Error(`上传失败，已重试${maxRetries}次`));
            }
          }
        });
        
        // 监听上传进度
        if (onProgress && typeof onProgress === 'function') {
          uploadTask.onProgressUpdate(onProgress);
        }
      };
      
      doUpload();
    });
  }

  /**
   * 删除云存储文件
   * @param {string} fileID - 文件ID
   * @returns {Promise<boolean>} - 删除是否成功
   */
  deleteCloudFile(fileID) {
    return new Promise((resolve) => {
      if (!fileID || !fileID.includes('cloud://')) {
        console.warn('无效的文件ID:', fileID);
        resolve(false);
        return;
      }
      
      wx.cloud.deleteFile({
        fileList: [fileID],
        success: (res) => {
          const deleted = res.fileList[0];
          if (deleted.status === 0) {
            console.log('文件删除成功:', fileID);
            resolve(true);
          } else {
            console.error('文件删除失败:', deleted);
            resolve(false);
          }
        },
        fail: (err) => {
          console.error('删除文件出错:', err);
          resolve(false);
        }
      });
    });
  }

  /**
   * 批量删除云存储文件
   * @param {Array<string>} fileIDs - 文件ID列表
   * @returns {Promise<object>} - 删除结果统计
   */
  batchDeleteCloudFiles(fileIDs) {
    return new Promise((resolve) => {
      const validFileIDs = fileIDs.filter(id => id && id.includes('cloud://'));
      
      if (validFileIDs.length === 0) {
        resolve({ success: 0, failed: 0, total: 0 });
        return;
      }
      
      wx.cloud.deleteFile({
        fileList: validFileIDs,
        success: (res) => {
          const stats = {
            success: 0,
            failed: 0,
            total: validFileIDs.length
          };
          
          res.fileList.forEach(item => {
            if (item.status === 0) {
              stats.success++;
            } else {
              stats.failed++;
            }
          });
          
          console.log('批量删除文件完成:', stats);
          resolve(stats);
        },
        fail: (err) => {
          console.error('批量删除文件失败:', err);
          resolve({ success: 0, failed: validFileIDs.length, total: validFileIDs.length });
        }
      });
    });
  }

  /**
   * 生成唯一的云存储路径
   * @param {string} prefix - 路径前缀
   * @param {string} extension - 文件扩展名
   * @returns {string} - 云存储路径
   */
  generateCloudPath(prefix = 'image', extension = 'jpg') {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `${prefix}/${timestamp}-${random}.${extension}`;
  }

  /**
   * 从文件路径提取扩展名
   * @param {string} filePath - 文件路径
   * @returns {string} - 扩展名
   */
  getFileExtension(filePath) {
    const match = filePath.match(/\.(\w+)$/);
    return match ? match[1].toLowerCase() : 'jpg';
  }

  /**
   * 验证图片文件
   * @param {string} filePath - 文件路径
   * @returns {Promise<boolean>} - 是否为有效图片
   */
  validateImage(filePath) {
    return new Promise((resolve) => {
      wx.getImageInfo({
        src: filePath,
        success: () => resolve(true),
        fail: () => resolve(false)
      });
    });
  }
}

// 创建单例实例
const imageUtils = new ImageUtils();

module.exports = imageUtils; 
 