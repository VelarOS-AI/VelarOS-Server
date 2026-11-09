import React from 'react'
import { createRoot } from 'react-dom/client'
import '@velaros-ai/ui/styles/components/conversation-basic.css'
import '@velaros-ai/ui/styles/tokens/theme-light.css'
import './styles.css'
import { App } from './App.js'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
