export interface ViewRefreshState {
  run: () => Promise<void>;
  canRefresh: boolean;
  isRefreshing: boolean;
}

export type RefreshStateChange = (state: ViewRefreshState | null) => void;
