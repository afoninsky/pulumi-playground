import Dummy from './components/example'
import Loki from './components/loki'
import Tempo from './components/tempo'
import VictoriaMetrics from './components/victoria'
import AlertManager from './components/alertmanager'
import VMAlert from './components/vmalert'
// import VMAgent from './components/vmagent'
import Grafana from './components/grafana'
import Nginx from './components/nginx'

const defaults = {
    namespace: 'default',
    tag: 'latest',
}

new Dummy('dummy', defaults)

// setup ingress controller
const ingress = new Nginx('nginx', defaults)

// create databases
const logs = new Loki('loki', defaults)
const traces = new Tempo('tempo', defaults)
const metrics = new VictoriaMetrics('victoria', defaults)

// launch UI
const grafana = new Grafana('grafana', { ...defaults,
    datasources: [logs, traces, metrics],
    dashboards: [metrics],
    ingress: ingress,
})

// create alerting layer
const alertmanager = new AlertManager('alertmanager', { ...defaults,
    rules: [],
    receivers: [],
    routes: [],
})
const alert = new VMAlert('vmalert', { ...defaults,
    notifiers: [alertmanager],
    alerts: [],
    storage: metrics,
})

// start scraping targets
// const agent = new VMAgent('vmagent', { ...defaults,
//     storage: metrics,
//     targets: [ingress, logs, traces, metrics, grafana, alertmanager, alert],
// })