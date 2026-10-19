import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { color } from './ui';

export type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// Single consistent icon set for the whole app: MaterialCommunityIcons, outline style.
export const ICON_SIZE = 22;
export const TAB_ICON_SIZE = 24;

export function AppIcon({ name, size = ICON_SIZE, iconColor }: { name: IconName; size?: number; iconColor?: string }) {
  return <MaterialCommunityIcons name={name} size={size} color={iconColor ?? color.text} style={{ fontFamily: 'material-community' }} />;
}

// Central icon map — change here only if an icon needs swapping.
export const icons = {
  home: 'home-outline',
  sale: 'cart-outline',
  purchase: 'shopping-outline',
  accounts: 'wallet-outline',
  bankCash: 'safe-square-outline',
  more: 'menu',
  products: 'package-variant-closed',
  stock: 'warehouse',
  customers: 'account-group-outline',
  vendors: 'truck-outline',
  collect: 'arrow-down-circle-outline',
  pay: 'arrow-up-circle-outline',
  profit: 'trending-up',
  settings: 'cog-outline',
  language: 'earth',
  add: 'plus',
  edit: 'pencil-outline',
  del: 'trash-can-outline',
  back: 'arrow-left',
  plus: 'plus',
  minus: 'minus',
  calc: 'calculator-variant-outline',
  history: 'history',
  ret: 'keyboard-return',
  retPurchase: 'tray-arrow-down',
  retSale: 'keyboard-return',
  save: 'content-save-outline',
  cancel: 'close',
  search: 'magnify',
  chevR: 'chevron-right',
  bell: 'bell-outline',
  print: 'printer-outline',
  share: 'share-variant-outline',
  done: 'check-circle-outline',
  filter: 'filter-outline',
  // Payment methods
  cash: 'cash',
  bkash: 'cellphone-message',
  nagad: 'cellphone',
  bank: 'bank-outline',
  moneyIn: 'arrow-down-bold-circle-outline',
  moneyOut: 'arrow-up-bold-circle-outline',
  opening: 'cash-plus',
  transfer: 'swap-horizontal',
  calendar: 'calendar-month-outline',
  copy: 'content-copy',
  eye: 'eye-outline',
  excel: 'file-excel-outline',
  ship: 'ferry',
  draft: 'content-save-edit-outline',
  office: 'domain',
  report: 'file-chart-outline',
  expense: 'wallet-outline',
  lock: 'lock-outline',
} as const satisfies Record<string, IconName>;
