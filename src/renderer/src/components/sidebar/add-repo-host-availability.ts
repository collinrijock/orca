import type { SidebarHostOption } from './sidebar-host-options'

export function canSelectAddRepoHost(host: Pick<SidebarHostOption, 'health'>): boolean {
  return host.health === 'local' || host.health === 'available'
}
