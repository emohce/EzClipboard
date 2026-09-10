import 'element-plus/theme-chalk/base.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import 'element-plus/theme-chalk/el-overlay.css'
import 'element-plus/theme-chalk/el-button.css'
import 'element-plus/theme-chalk/el-message-box.css'
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-card.css'
import 'element-plus/theme-chalk/el-input.css'
import 'element-plus/theme-chalk/el-select.css'
import 'element-plus/theme-chalk/el-option.css'
import 'element-plus/theme-chalk/el-scrollbar.css'
import 'element-plus/theme-chalk/el-tag.css'
import 'element-plus/theme-chalk/el-popover.css'
import 'element-plus/theme-chalk/el-tooltip.css'
import 'element-plus/theme-chalk/el-divider.css'
import 'element-plus/theme-chalk/el-progress.css'
import 'element-plus/theme-chalk/el-dialog.css'
import 'element-plus/theme-chalk/el-form.css'
import 'element-plus/theme-chalk/el-form-item.css'
import 'element-plus/theme-chalk/el-pagination.css'
import 'element-plus/theme-chalk/el-radio.css'
import 'element-plus/theme-chalk/el-radio-group.css'
import 'element-plus/theme-chalk/el-radio-button.css'
import {
  ElButton,
  ElMessageBox,
  ElMessage,
  ElCard,
  ElInput,
  ElSelect,
  ElOption,
  ElScrollbar,
  ElTag,
  ElPopover,
  ElTooltip,
  ElDivider,
  ElProgress,
  ElDialog,
  ElForm,
  ElFormItem,
  ElPagination,
  ElRadioGroup,
  ElRadioButton
} from 'element-plus'

const components = [
  ElButton,
  ElMessageBox,
  ElMessage,
  ElCard,
  ElInput,
  ElSelect,
  ElOption,
  ElScrollbar,
  ElTag,
  ElPopover,
  ElTooltip,
  ElDivider,
  ElProgress,
  ElDialog,
  ElForm,
  ElFormItem,
  ElPagination,
  ElRadioGroup,
  ElRadioButton
]

export default function registerElement(app) {
  components.forEach((c) => {
    let name = transferCamel(c.name)
    app.component(name, c)
  })
}

function transferCamel(camel) {
  return camel
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .slice(1)
}
