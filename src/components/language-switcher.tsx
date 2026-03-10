import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface LanguageSwitcherProps {
  className?: string
  compact?: boolean
}

export function LanguageSwitcher({ className, compact = false }: LanguageSwitcherProps) {
  const { i18n } = useTranslation()
  const currentLang = i18n.language?.startsWith('zh') ? 'zh-CN' : 'en'

  const setLanguage = (lang: string) => {
    i18n.changeLanguage(lang)
    document.documentElement.lang = lang
  }

  if (compact) {
    return (
      <button
        onClick={() => setLanguage(currentLang === 'en' ? 'zh-CN' : 'en')}
        className={cn(
          "text-xs font-medium text-muted-foreground hover:text-foreground transition-colors",
          className
        )}
        aria-label="Toggle language"
      >
        {currentLang === 'en' ? '中文' : 'EN'}
      </button>
    )
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        onClick={() => setLanguage('en')}
        className={cn(
          "px-2 py-1 text-xs rounded-md transition-colors",
          currentLang === 'en'
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        )}
      >
        EN
      </button>
      <button
        onClick={() => setLanguage('zh-CN')}
        className={cn(
          "px-2 py-1 text-xs rounded-md transition-colors",
          currentLang === 'zh-CN'
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        )}
      >
        中文
      </button>
    </div>
  )
}
