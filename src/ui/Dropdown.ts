/**
 * A dark-themed select. The native <select> popup cannot be styled consistently across browsers, so this is a
 * combobox + listbox built from buttons, with the usual keyboard model (Enter/Space/arrows open it, arrows/Home/End move,
 * Enter/Space pick, Escape/Tab close) and ARIA roles.
 */
export class Dropdown {
  readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly list: HTMLElement;
  private readonly items: HTMLElement[] = [];
  private current = '';
  private active = 0;
  private isOpen = false;
  private static counter = 0;

  constructor(
    readonly id: string,
    private readonly options: [string, string][],
    private readonly onChange: (value: string) => void,
    labelledBy?: string,
  ) {
    const uid = `${id}-${Dropdown.counter++}`;
    this.root = document.createElement('div');
    this.root.className = 'dropdown';
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.id = id;
    this.button.className = 'dropdown-button';
    this.button.setAttribute('role', 'combobox');
    this.button.setAttribute('aria-haspopup', 'listbox');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.setAttribute('aria-controls', `${uid}-list`);
    if (labelledBy) this.button.setAttribute('aria-labelledby', `${labelledBy} ${id}`);
    this.list = document.createElement('ul');
    this.list.id = `${uid}-list`;
    this.list.className = 'dropdown-list';
    this.list.setAttribute('role', 'listbox');
    this.list.hidden = true;
    options.forEach(([value, text], i) => {
      const li = document.createElement('li');
      li.id = `${uid}-opt-${i}`;
      li.className = 'dropdown-option';
      li.setAttribute('role', 'option');
      li.textContent = text;
      li.dataset.value = value;
      // mousedown, not click: the button must not lose focus before the choice registers
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.choose(i);
      });
      li.addEventListener('mousemove', () => this.setActive(i));
      this.list.appendChild(li);
      this.items.push(li);
    });
    this.root.append(this.button, this.list);

    this.button.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    this.button.addEventListener('keydown', (e) => this.onKey(e));
    this.button.addEventListener('blur', () => this.close());
  }

  get value(): string {
    return this.current;
  }

  set value(v: string) {
    const i = this.options.findIndex(([val]) => val === v);
    if (i < 0) return;
    this.current = v;
    this.active = i;
    this.button.textContent = this.options[i][1];
    this.items.forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
  }

  focus(): void {
    this.button.focus();
  }

  private open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.list.hidden = false;
    this.root.classList.add('open');
    this.button.setAttribute('aria-expanded', 'true');
    this.setActive(this.options.findIndex(([val]) => val === this.current));
  }

  private close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.list.hidden = true;
    this.root.classList.remove('open');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.removeAttribute('aria-activedescendant');
  }

  private setActive(i: number): void {
    this.active = Math.max(0, Math.min(this.items.length - 1, i));
    this.items.forEach((li, k) => li.classList.toggle('active', k === this.active));
    this.button.setAttribute('aria-activedescendant', this.items[this.active].id);
  }

  private choose(i: number): void {
    const [value] = this.options[i];
    this.close();
    if (value === this.current) return;
    this.value = value;
    this.onChange(value);
  }

  private onKey(e: KeyboardEvent): void {
    const k = e.key;
    if (!this.isOpen) {
      if (k === 'Enter' || k === ' ' || k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        this.open();
      }
      return;
    }
    if (k === 'ArrowDown') this.setActive(this.active + 1);
    else if (k === 'ArrowUp') this.setActive(this.active - 1);
    else if (k === 'Home') this.setActive(0);
    else if (k === 'End') this.setActive(this.items.length - 1);
    else if (k === 'Enter' || k === ' ') this.choose(this.active);
    else if (k === 'Escape') {
      this.close();
      e.stopPropagation(); // closes the list only, not the settings screen
    } else if (k === 'Tab') {
      this.close();
      return;
    } else return;
    e.preventDefault();
  }
}
