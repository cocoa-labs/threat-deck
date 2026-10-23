import { create } from 'zustand';

interface LayoutState {
  heroScrolledAway: boolean;
  scrollToHero: (() => void) | null;
  scrollContainer: HTMLElement | null;
  setHeroScrolledAway: (value: boolean) => void;
  setScrollToHero: (fn: (() => void) | null) => void;
  setScrollContainer: (el: HTMLElement | null) => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  heroScrolledAway: false,
  scrollToHero: null,
  scrollContainer: null,
  setHeroScrolledAway: (value) => set({ heroScrolledAway: value }),
  setScrollToHero: (fn) => set({ scrollToHero: fn }),
  setScrollContainer: (el) => set({ scrollContainer: el }),
}));
