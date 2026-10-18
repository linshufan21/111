import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { Admin } from './pages/Admin'
import { DevMail } from './pages/DevMail'
import { Feed } from './pages/Feed'
import { ForgotPassword } from './pages/ForgotPassword'
import { Privacy, Terms } from './pages/Legal'
import { Login } from './pages/Login'
import { Me } from './pages/Me'
import { NotFound } from './pages/NotFound'
import { Notifications } from './pages/Notifications'
import { Question } from './pages/Question'
import { ResetPassword } from './pages/ResetPassword'
import { Settings } from './pages/Settings'
import { VerifyEmail } from './pages/VerifyEmail'

function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      let id = hash.slice(1)
      try {
        id = decodeURIComponent(id)
      } catch {
        id = ''
      }
      const target = id ? document.getElementById(id) : null
      if (target) {
        target.scrollIntoView({ block: 'start' })
        return
      }
    }
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname, hash])
  return null
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Feed />} />
        <Route path="/login" element={<Login />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/q/:id" element={<Question />} />
        <Route path="/me" element={<Me />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/dev/mail" element={<DevMail />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}
