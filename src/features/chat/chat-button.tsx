import { MessageSquare } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'
import { useChatRealtime, useChatUnread } from './api'

/** In the top bar: the chat, with how many messages wait to be read */
export function ChatButton() {
  useChatRealtime()
  const unread = useChatUnread().data ?? 0
  return (
    <Button variant="ghost" size="icon-sm" asChild className="relative">
      <Link to="/chat" aria-label={unread ? t('Chat, {n} unread', { n: unread }) : t('Chat')} title={t('Chat')}>
        <MessageSquare />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Link>
    </Button>
  )
}
