export type OpenDialogProperty =
  | 'openFile'
  | 'openDirectory'
  | 'multiSelections'
  | 'showHiddenFiles'
  | 'createDirectory'
  | 'promptToCreate'
  | 'noResolveAliases'
  | 'treatPackageAsDirectory'
  | 'dontAddToRecent';

interface OpenDialogRequest {
  directory?: boolean;
  multiple?: boolean;
  properties?: OpenDialogProperty[];
}

/**
 * Electron requires a selectable target even when another capability such as
 * `multiSelections` is enabled.
 */
export function getOpenDialogProperties(options: OpenDialogRequest): OpenDialogProperty[] {
  const properties = [...(options.properties ?? [])];
  const add = (property: OpenDialogProperty) => {
    if (!properties.includes(property)) properties.push(property);
  };

  add(options.directory ? 'openDirectory' : 'openFile');
  if (options.multiple) add('multiSelections');

  return properties;
}
