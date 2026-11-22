const KEY = "sketchroom.guestName";

export function loadGuestName(): string {
    try {
        return sessionStorage.getItem(KEY) ?? "";
    } catch {
        return "";
    }
}

export function saveGuestName(name: string) {
    try {
        sessionStorage.setItem(KEY, name);
    } catch {
        // Storage can be blocked, so name only lasts until page is reloaded
    }
}
