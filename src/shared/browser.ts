type Callback<T> = (value: T) => void;

const runtime = chrome.runtime;

export const extension = {
  getURL(path: string) {
    return runtime.getURL(path);
  },

  async sendMessage<TResponse>(message: unknown): Promise<TResponse> {
    return runtime.sendMessage(message) as Promise<TResponse>;
  },

  onMessage(listener: (message: unknown, sender: chrome.runtime.MessageSender) => unknown | Promise<unknown>) {
    runtime.onMessage.addListener((message, sender, sendResponse: Callback<unknown>) => {
      Promise.resolve(listener(message, sender))
        .then((response) => {
          if (response !== undefined) sendResponse(response);
        })
        .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    });
  },

  async queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  },

  async sendTabMessage<TResponse>(tabId: number, message: unknown): Promise<TResponse> {
    return chrome.tabs.sendMessage(tabId, message) as Promise<TResponse>;
  },

  storage: {
    async get<T extends Record<string, unknown>>(keys: string[] | Partial<T>): Promise<T> {
      return chrome.storage.local.get(keys as string[] | Partial<T>) as Promise<T>;
    },
    async set(items: Record<string, unknown>): Promise<void> {
      await chrome.storage.local.set(items);
    }
  }
};
