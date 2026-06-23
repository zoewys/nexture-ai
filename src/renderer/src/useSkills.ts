import { useCallback, useEffect, useState } from 'react'
import type { SkillSummary } from '@shared/types'

export function useSkills() {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setSkills(await window.api.listSkills())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { skills, loading, reload }
}
