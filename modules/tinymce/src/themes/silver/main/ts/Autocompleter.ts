import { AddEventsBehaviour, AlloyEvents, Behaviour, GuiFactory, Highlighting, InlineView, ItemTypes, SystemEvents } from '@ephox/alloy';
import { InlineContent } from '@ephox/bridge';
import { Arr, Cell, Id, Optional } from '@ephox/katamari';
import { Attribute, Css, Replication, SelectorFind, SimRange, SugarElement } from '@ephox/sugar';

import Editor from 'tinymce/core/api/Editor';
import { AutocompleteLookupData } from 'tinymce/core/autocomplete/AutocompleteTypes';

import { AutocompleterEditorEvents, AutocompleterUiApi } from './autocomplete/AutocompleteEditorEvents';
import { UiFactoryBackstageShared } from './backstage/Backstage';
import ItemResponse from './ui/menus/item/ItemResponse';
import { createPartialMenuWithAlloyItems } from './ui/menus/menu/MenuUtils';
import { createAutocompleteItems, createInlineMenuFrom, FocusMode } from './ui/menus/menu/SingleMenu';

const rangeToSimRange = (r: Range) => SimRange.create(SugarElement.fromDom(r.startContainer), r.startOffset, SugarElement.fromDom(r.endContainer), r.endOffset);

const simRangeToRange = (r: SimRange) => {
  const rng = new window.Range();
  rng.setStart(r.start.dom, r.soffset);
  rng.setEnd(r.finish.dom, r.foffset);
  return rng;
};

const register = (editor: Editor, sharedBackstage: UiFactoryBackstageShared): void => {
  const autocompleterId = Id.generate('autocompleter');

  const processingAction = Cell<boolean>(false);
  const activeState = Cell<boolean>(false);

  const autocompleter = GuiFactory.build(
    InlineView.sketch({
      dom: {
        tag: 'div',
        classes: [ 'tox-autocompleter' ],
        attributes: {
          id: autocompleterId
        }
      },
      components: [ ],
      fireDismissalEventInstead: { },
      inlineBehaviours: Behaviour.derive([
        AddEventsBehaviour.config('dismissAutocompleter', [
          AlloyEvents.run(SystemEvents.dismissRequested(), () => cancelIfNecessary()),
          AlloyEvents.run(SystemEvents.highlight(), (_, se) => {
            Attribute.getOpt(se.event.target, 'id').each((id: string) => Attribute.set(SugarElement.fromDom(editor.getBody()), 'aria-activedescendant', id));
          }),
        ])
      ]),
      lazySink: sharedBackstage.getSink
    })
  );

  const isMenuOpen = () => InlineView.isOpen(autocompleter);
  const isActive = activeState.get;

  const hideIfNecessary = () => {
    if (isMenuOpen()) {
      InlineView.hide(autocompleter);

      editor.dom.remove(autocompleterId, false);
      const editorBody = SugarElement.fromDom(editor.getBody());
      Attribute.getOpt(editorBody, 'aria-owns')
        .filter((ariaOwnsAttr) => ariaOwnsAttr === autocompleterId)
        .each(() => {
          Attribute.remove(editorBody, 'aria-owns');
          Attribute.remove(editorBody, 'aria-activedescendant');
        });
    }
  };

  const getMenu = () => InlineView.getContent(autocompleter).bind((tmenu) => {
    // The autocompleter menu will be the first child component of the tiered menu.
    // Unfortunately a memento can't be used to do this lookup because the component
    // id is changed while generating the tiered menu.
    return Arr.get(tmenu.components(), 0);
  });

  const cancelIfNecessary = () => editor.execCommand('mceAutocompleterClose');

  const getCombinedItems = (matches: AutocompleteLookupData[], range: SimRange): ItemTypes.ItemSpec[] => {
    const columns = Arr.findMap(matches, (m) => Optional.from(m.columns)).getOr(1);

    return Arr.bind(matches, (match) => {
      const choices = match.items;

      return createAutocompleteItems(
        choices,
        match.matchText,
        (itemValue, itemMeta) => {
          const autocompleterApi: InlineContent.AutocompleterInstanceApi = {
            hide: () => cancelIfNecessary(),
            reload: (fetchOptions: Record<string, any>) => {
              hideIfNecessary();
              editor.execCommand('mceAutocompleterReload', false, { fetchOptions });
            }
          };
          processingAction.set(true);
          match.onAction(autocompleterApi, simRangeToRange(range), itemValue, itemMeta);
          processingAction.set(false);
        },
        columns,
        ItemResponse.BUBBLE_TO_SANDBOX,
        sharedBackstage,
        match.highlightOn
      );
    });
  };

  const display = (lookupData: AutocompleteLookupData[], items: ItemTypes.ItemSpec[], range: SimRange) => {
    // Display the autocompleter menu
    const columns: InlineContent.ColumnTypes = Arr.findMap(lookupData, (ld) => Optional.from(ld.columns)).getOr(1);
    InlineView.showMenuAt(
      autocompleter,
      {
        anchor: {
          type: 'selection',
          getSelection: () => Optional.some(range),
          root: SugarElement.fromDom(editor.getBody()),
        }
      },
      createInlineMenuFrom(
        createPartialMenuWithAlloyItems(
          'autocompleter-value',
          true,
          items,
          columns,
          { menuType: 'normal' }
        ),
        columns,
        FocusMode.ContentFocus,
        // Use the constant.
        'normal'
      )
    );

    getMenu().each(Highlighting.highlightFirst);
  };

  const updateDisplay = (lookupData: AutocompleteLookupData[], range: SimRange) => {
    const combinedItems = getCombinedItems(lookupData, range);

    // Open the autocompleter if there are items to show
    if (combinedItems.length > 0) {
      display(lookupData, combinedItems, range);
      Attribute.set(SugarElement.fromDom(editor.getBody()), 'aria-owns', autocompleterId);
      if (!editor.inline) {
        cloneAutocompleterToEditorDoc();
      }
    } else {
      hideIfNecessary();
    }
  };

  const cloneAutocompleterToEditorDoc = () => {
    if (editor.dom.get(autocompleterId)) {
      editor.dom.remove(autocompleterId, false);
    }

    const docElm = editor.getDoc().documentElement;
    const selection = editor.selection.getNode();
    const newElm = Replication.deep<Element>(autocompleter.element);
    Css.setAll(newElm, {
      border: '0',
      clip: 'rect(0 0 0 0)',
      height: '1px',
      margin: '-1px',
      overflow: 'hidden',
      padding: '0',
      position: 'absolute',
      width: '1px',
      top: `${selection.offsetTop}px`,
      left: `${selection.offsetLeft}px`,
    });
    editor.dom.add(docElm, newElm.dom);

    // Clean up positioning styles so that the "hidden" autocompleter is around the selection
    SelectorFind.descendant(newElm, '[role="menu"]').each((child) => {
      Css.remove(child, 'position');
      Css.remove(child, 'max-height');
    });
  };

  editor.on('AutocompleterStart', ({ lookupData, range }) => {
    activeState.set(true);
    processingAction.set(false);
    updateDisplay(lookupData, rangeToSimRange(range));
  });

  editor.on('AutocompleterUpdate', ({ lookupData, range }) => updateDisplay(lookupData, rangeToSimRange(range)));

  editor.on('AutocompleterEnd', () => {
    // Hide the menu and reset
    hideIfNecessary();
    activeState.set(false);
    processingAction.set(false);
  });

  const autocompleterUiApi: AutocompleterUiApi = {
    cancelIfNecessary,
    isMenuOpen,
    isActive,
    isProcessingAction: processingAction.get,
    getMenu
  };

  AutocompleterEditorEvents.setup(autocompleterUiApi, editor);
};

export const Autocompleter = {
  register
};
