import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './assets/base.css'
import { flushWorkspaceEditors } from './editor/workspace-flush'

const app = createApp(App)

app.config.errorHandler = (error, instance, info) => {
  console.error('Unhandled renderer error', { error, instance, info })
}

app.use(router)
window.openNovel.lifecycle.onFlushRequest((requestId) => {
  void flushWorkspaceEditors().then((saved) => {
    window.openNovel.lifecycle.completeFlush(requestId, saved)
  })
})
app.mount('#app')
