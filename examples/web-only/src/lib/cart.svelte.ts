// Shared reactive state in a .svelte.ts module (runes outside components).
class Cart {
  items = $state<string[]>([]);
  get count() {
    return this.items.length;
  }
  add(item: string) {
    this.items.push(item);
  }
}

export const cart = new Cart();
