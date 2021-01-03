import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import * as yaml from 'js-yaml'

import * as olly from '../src'
import * as pluggable from '../src/pluggable'

interface Args extends olly.ComponentArgs {
    tag: string
}

export default class Tempo extends olly.ComponentResource implements pluggable.GrafanaDS, pluggable.ScrapeTarget {

    readonly datasource: pluggable.GrafanaDSItem
    readonly metrics: pluggable.ScrapeTargetItem[]

    private readonly args: Args


    constructor(name: string, args: Args, opts?: pulumi.ComponentResourceOptions) {
        super(olly.ComponentType.Database, name, args, opts)    
        this.args = args

        // create set of k8s manifests
        const configmap = this.createConfigMap()
        const deployment = this.createDeployment(configmap)
        const service = this.createService(deployment)
        
        const { name: svcName, namespace: svcNamespace } = service.metadata
        const svcPort = service.spec.ports[0].port
        
        // expose own url as grafana datasource
        this.datasource = {
            name: this.name,
            type: 'tempo',
            URL: pulumi.interpolate `http://${svcName}.${svcNamespace}:${svcPort}`
        }

        // expose service endpoint to scrape metrics
        this.metrics = [{
            endpoint: svcName,
            port: service.spec.ports[0].name,
            namespace: svcNamespace,
        }]
    }

    private createConfigMap(): k8s.core.v1.ConfigMap {
        const tempoConfig = this.defaultTempoConfig()
        const queryConfig = {
            backend: 'localhost:3100'
        }

        return new k8s.core.v1.ConfigMap(this.name, {
            metadata: {
                name: this.name,
                namespace: this.args.namespace,
                labels: this.labels
            },
            data: {
                'tempo.yaml': yaml.safeDump(tempoConfig),
                'query.ini': yaml.safeDump(queryConfig),
            }
        }, { parent: this })
    }

    private createDeployment(configmap: k8s.core.v1.ConfigMap): k8s.apps.v1.Deployment {

        const tempo: k8s.types.input.core.v1.Container = {
            name: 'tempo',
            image: `grafana/tempo:${this.args.tag}`,
            ports: [
                { name: 'grpc-otlp', containerPort: 55680 },
            ],
            args: ['-config.file=/etc/tempo/tempo.yaml'],
            volumeMounts: [
                { name: 'storage', mountPath: '/var/tempo' },
                {
                    name: 'config',
                    mountPath: '/etc/tempo/tempo.yaml',
                    subPath: 'tempo.yaml',
                    readOnly: true,
                }
            ]
        }
        const query: k8s.types.input.core.v1.Container = {
            name: 'query',
            image: `grafana/tempo-query:${this.args.tag}`,
            ports: [
                { name: 'http-query', containerPort: 16686 },
            ],
            args: ['--grpc-storage-plugin.configuration-file=/etc/tempo/query.yaml'],
            volumeMounts: [
                { name: 'storage', mountPath: '/var/tempo' },
                {
                    name: 'config',
                    mountPath: '/etc/tempo/query.yaml',
                    subPath: 'query.yaml',
                    readOnly: true,
                }
            ]
        }
        
        return this.deploymentTemplate(this.name, {
            name: this.name,
            labels: this.labels,
            labelSelector: this.labels,
            namespace: this.args.namespace,
            replicas: 1,
            containers: [tempo, query],
            volumes: [
                { name: 'storage', emptyDir: {}},
                { name: 'config', configMap: { name: configmap.metadata.name } },
            ]
        }, { parent: this })
    }

    private createService(deployment: k8s.apps.v1.Deployment): k8s.core.v1.Service {
        
        return new k8s.core.v1.Service(this.name, {
            metadata: {
                name: this.name,
                labels: this.labels,
                namespace: this.args.namespace
            },
            spec: {
                ports: [
                    { name: 'http-query', port: 16686, targetPort: 'http-query' }, // NOTE: should go first as used in `this.dsURL`
                    { name: 'grpc-otlp', port: 55680, targetPort: 'grpc-otlp' },
                ],
                selector: deployment.spec.selector.matchLabels,
            },
        }, { parent: this })
    }

    private defaultTempoConfig() {
        return {
            auth_enabled: false,
            server: {
                http_listen_port: 3100
            },
            distributor: {
                receivers: {
                    otlp: {
                        protocols: {
                            grpc: {
                                endpoint: '0.0.0.0:55680'
                            }
                        }
                    }
                }
            },
            ingester: {
                trace_idle_period: '10s',
                traces_per_block: 100,
                max_block_duration: '5m'
            },
            compactor: {
                compaction: {
                    compaction_window: '1h',
                    max_compaction_objects: 1000000,
                    block_retention: '1h',
                    compacted_block_retention: '10m'
                }
            },
            storage: {
                trace: {
                    backend: 'local',
                    wal: {
                        path: '/tmp/tempo/wal',
                        bloom_filter_false_positive: 0.05,
                        index_downsample: 10
                    },
                    local: {
                        path: '/tmp/tempo/blocks'
                    },
                    pool: {
                        max_workers: 100,
                        queue_depth: 10000
                    }
                }
            }
        }
    }
}