import { useCallback, useState } from 'react';

export function useBootSplash() {
  const [isVisible, setIsVisible] = useState(true);

  const hideSplash = useCallback(() => {
    setIsVisible(false);
  }, []);

  return {
    isVisible,
    hideSplash,
  };
}
