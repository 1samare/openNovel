import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './assets/base.css'

const app = createApp(App)

app.config.errorHandler = (error, instance, info) => {
  console.error('Unhandled renderer error', { error, instance, info })
}

app.use(router)
app.mount('#app')
