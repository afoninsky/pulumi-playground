import * as pulumi from '@pulumi/pulumi'

export interface GrafanaDSItem {
    name: string
    type: string
    URL: pulumi.Output<string>
    data?: any
}

export interface ScrapeTargetItem {
    endpoint: pulumi.Output<string>
    port: pulumi.Output<string>
    namespace: pulumi.Output<string>
}

export interface PrometheusItem {
    remoteReadURL: pulumi.Output<string>
    remoteWriteURL: pulumi.Output<string>
}


// component can be used to create grafana datasource
export interface GrafanaDS {
    datasource: GrafanaDSItem
}

// component can be scraped to collect prometheus metrics
export interface ScrapeTarget {
    metrics: ScrapeTargetItem[]
}

// component exposes prometheus-compatible read/write endpoints
export interface Prometheus {
    prometheus: PrometheusItem
}

// component exposes urls for receiving notifiations
export interface Notifier {
    notificationURLs: pulumi.Output<string>[]
}