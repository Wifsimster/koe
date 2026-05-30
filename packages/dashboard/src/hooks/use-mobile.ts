import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  // Seed from the current viewport instead of initialising in an effect:
  // the value is known synchronously on the client, so there's no reason
  // to render once with a placeholder and then immediately set it.
  const [isMobile, setIsMobile] = React.useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false,
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
