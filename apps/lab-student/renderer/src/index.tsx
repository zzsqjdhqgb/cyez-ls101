import { bootstrapRenderer } from '@ls101/desktop-ui/bootstrap'

bootstrapRenderer({ loadApplication: () => import('./main') })
