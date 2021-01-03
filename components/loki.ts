import * as pulumi from '@pulumi/pulumi'
import * as k8s from '@pulumi/kubernetes'
import * as yaml from 'js-yaml'

import * as olly from '../src'
import * as pluggable from '../src/pluggable'

interface Args extends olly.ComponentArgs {
    tag: string
}

export default class Loki extends olly.ComponentResource implements pluggable.GrafanaDS, pluggable.ScrapeTarget {

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
            type: 'loki',
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

        const config = this.defaultConfig()
        return new k8s.core.v1.ConfigMap(this.name, {
            metadata: {
                name: this.name,
                namespace: this.args.namespace,
                labels: this.labels
            },
            data: {
                'config.yaml': yaml.safeDump(config),
            }
        }, { parent: this })
    }

    private createDeployment(configmap: k8s.core.v1.ConfigMap): k8s.apps.v1.Deployment {

        const container: k8s.types.input.core.v1.Container = {
            name: 'loki',
            image: `grafana/loki:${this.args.tag}`,
            args: [
                '-config.file=/etc/loki/config.yaml'
            ],
            ports: [
                { name: 'http', containerPort: 3100 },
                { name: 'gossip', containerPort: 7946 },
            ],
            // TODO: check
            // readinessProbe: {
            //     httpGet: {
            //         port: 'http',
            //         path: '/ready',
            //     },
            // },
            livenessProbe: {
                tcpSocket: {
                    port: 'http',
                },
            },
            volumeMounts: [
                { name: 'storage', mountPath: '/data' },
                {
                    name: 'config',
                    mountPath: '/etc/loki/config.yaml',
                    subPath: 'config.yaml',
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
            containers: [container],
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
                ports: [{ name: 'http', port: 3100, targetPort: 'http' }],
                selector: deployment.spec.selector.matchLabels,
            },
        }, { parent: this })
    }

    private defaultConfig() {
        return {
            'auth_enabled': false,
            'server':{
                'http_listen_port':3100
            },
            'ingester':{
                'lifecycler':{
                    'address':'127.0.0.1',
                    'ring':{
                        'kvstore':{
                            'store':'inmemory'
                        },
                        'replication_factor':1
                    },
                    'final_sleep':'0s'
                },
                'chunk_idle_period':'1h',
                'max_chunk_age':'1h',
                'chunk_target_size':1048576,
                'chunk_retain_period':'30s',
                'max_transfer_retries':0
            },
            'schema_config':{
                'configs':[
                    {
                        'from':'2020-10-24',
                        'store':'boltdb-shipper',
                        'object_store':'filesystem',
                        'schema':'v11',
                        'index':{
                            'prefix':'index_',
                            'period':'24h'
                        }
                    }
                ]
            },
            'storage_config':{
                'boltdb_shipper':{
                    'active_index_directory':'/data/boltdb-shipper-active',
                    'cache_location':'/data/boltdb-shipper-cache',
                    'cache_ttl':'24h',
                    'shared_store':'filesystem'
                },
                'filesystem':{
                    'directory':'/data/chunks'
                }
            },
            'compactor':{
                'working_directory':'/data/boltdb-shipper-compactor',
                'shared_store':'filesystem'
            },
            'limits_config':{
                'reject_old_samples':true,
                'reject_old_samples_max_age':'168h'
            },
            'chunk_store_config':{
                'max_look_back_period':'0s'
            },
            'table_manager':{
                'retention_deletes_enabled':false,
                'retention_period':'0s'
            },
            'ruler':{
                'storage':{
                    'type':'local',
                    'local':{
                        'directory':'/data/rules'
                    }
                },
                'rule_path':'/data/rules-temp',
                'alertmanager_url':'http://localhost:9093',
                'ring':{
                    'kvstore':{
                        'store':'inmemory'
                    }
                },
                'enable_api':true
            }
        }
    }
}