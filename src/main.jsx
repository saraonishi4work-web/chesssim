import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { onAuthStateChanged } from 'firebase/auth'
import ChessSim from './chessgame.jsx'
import { auth, initAnalytics } from './firebase'
import './index.css'

function AppRoot() {
  useEffect(() => {
    initAnalytics().catch(() => null)
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        console.log('Logged in user:', user.email)
      } else {
        console.log('No user signed in.')
      }
    })

    return () => unsubscribe()
  }, [])

  return <ChessSim />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppRoot />
  </React.StrictMode>,
)