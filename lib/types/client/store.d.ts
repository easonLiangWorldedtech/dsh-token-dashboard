type Listener = () => void;
/** Panel visibility, toggled by the sidebar entry and the panel close button. */
export declare const panelStore: {
    getSnapshot: () => boolean;
    subscribe: (listener: Listener) => () => void;
    set(update: (prev: boolean) => boolean): void;
};
export declare const togglePanel: () => void;
export declare const closePanel: () => void;
export {};
//# sourceMappingURL=store.d.ts.map