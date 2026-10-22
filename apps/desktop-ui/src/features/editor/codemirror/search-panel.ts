import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery
} from '@codemirror/search';
import { StateEffect } from '@codemirror/state';
import { runScopeHandlers, type EditorView, type Panel } from '@codemirror/view';

const expandReplacement = StateEffect.define<boolean>();

/** 查询、匹配和替换由 CodeMirror 处理，这里只提供紧凑的操作面板。 */
export function openReplacePanel(view: EditorView): boolean {
  openSearchPanel(view);
  view.dispatch({ effects: expandReplacement.of(true) });
  return true;
}

function iconButton(label: string, path: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cm-search-action';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', action);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  pathElement.setAttribute('d', path);
  svg.append(pathElement);
  button.append(svg);
  return button;
}

function searchInput(label: string, name: string): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'cm-textfield';
  input.placeholder = label;
  input.name = name;
  input.setAttribute('aria-label', label);
  input.autocomplete = 'off';
  input.spellcheck = false;
  return input;
}

export function createSearchPanel(view: EditorView): Panel {
  const dom = document.createElement('div');
  dom.className = 'cm-search';
  dom.setAttribute('role', 'search');
  dom.setAttribute('aria-label', '文档内查找与替换');
  const searchField = searchInput('查找', 'search');
  searchField.setAttribute('main-field', 'true');
  const replaceField = searchInput('替换', 'replace');
  const searchBox = document.createElement('div');
  searchBox.className = 'cm-search-field';
  searchBox.append(searchField);
  const actions = document.createElement('div');
  actions.className = 'cm-search-actions';
  const replacement = document.createElement('div');
  replacement.className = 'cm-replace-row';
  replacement.hidden = true;
  const replaceActions = document.createElement('div');
  replaceActions.className = 'cm-search-actions';
  const expand = iconButton('展开替换', 'm9 5 7 7-7 7', () => setExpanded(replacement.hidden === true));
  expand.setAttribute('aria-expanded', 'false');
  function setExpanded(expanded: boolean) {
    replacement.hidden = !expanded;
    expand.setAttribute('aria-expanded', String(expanded));
    expand.title = expanded ? '收起替换' : '展开替换';
    expand.setAttribute('aria-label', expand.title);
  }
  const toggles = (
    [
      ['caseSensitive', '区分大小写', 'Aa'],
      ['wholeWord', '全词匹配', 'ab'],
      ['regexp', '正则表达式', '.*']
    ] as const
  ).map(([key, label, text]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `cm-search-option cm-search-${key}`;
    button.title = label;
    button.textContent = text;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => {
      const query = getSearchQuery(view.state);
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ ...query, [key]: !query[key] })) });
    });
    searchBox.append(button);
    return { key, button };
  });
  actions.append(
    iconButton('上一个匹配（Shift+Enter）', 'm5 12 7-7 7 7M12 5v14', () => {
      findPrevious(view);
    }),
    iconButton('下一个匹配（Enter）', 'm5 12 7 7 7-7M12 5v14', () => {
      findNext(view);
    }),
    iconButton('关闭查找（Escape）', 'm6 6 12 12M6 18 18 6', () => {
      closeSearchPanel(view);
    })
  );
  const replaceOne = iconButton('替换当前匹配', 'M4 4h7v6H4zM16 14h4v6h-4zM7 13v4h5m-3-3 3 3-3 3', () => {
    replaceNext(view);
  });
  const replaceEvery = iconButton(
    '全部替换',
    'M3 3h6v5H3zM14 3h6v5h-6zM3 16h6v5H3zM14 16h6v5h-6zM6 10v4m-2-2 2 2 2-2m9-2v4m-2-2 2 2 2-2',
    () => {
      replaceAll(view);
    }
  );
  replaceActions.append(replaceOne, replaceEvery);
  replacement.append(replaceField, replaceActions);
  dom.append(expand, searchBox, actions, replacement);

  function commit() {
    const query = new SearchQuery({
      ...getSearchQuery(view.state),
      search: searchField.value,
      replace: replaceField.value
    });
    view.dispatch({ effects: setSearchQuery.of(query) });
  }
  for (const field of [searchField, replaceField]) {
    field.addEventListener('input', event => {
      if (!(event as InputEvent).isComposing) commit();
    });
    field.addEventListener('compositionend', commit);
  }
  dom.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (runScopeHandlers(view, event, 'search-panel')) event.preventDefault();
    else if (event.key === 'Enter' && (event.target === searchField || event.target === replaceField)) {
      event.preventDefault();
      if (event.target === replaceField) replaceNext(view);
      else (event.shiftKey ? findPrevious : findNext)(view);
    }
  });
  function sync() {
    const query = getSearchQuery(view.state);
    if (searchField.value !== query.search) searchField.value = query.search;
    if (replaceField.value !== query.replace) replaceField.value = query.replace;
    searchField.setAttribute('aria-invalid', String(Boolean(query.search && query.regexp && !query.valid)));
    for (const { key, button } of toggles) button.setAttribute('aria-pressed', String(query[key]));
    expand.disabled = view.state.readOnly;
    replaceOne.disabled = replaceEvery.disabled = view.state.readOnly || !query.valid;
  }
  sync();
  return {
    dom,
    top: true,
    mount() {
      searchField.select();
    },
    update(update) {
      for (const transaction of update.transactions)
        for (const effect of transaction.effects) if (effect.is(expandReplacement)) setExpanded(effect.value);
      sync();
    }
  };
}
