import * as pulumi from '@pulumi/pulumi'
import * as k8s from '@pulumi/kubernetes'
import * as ini from 'ini'
import * as yaml from 'js-yaml'

import * as olly from '../src'
import * as pluggable from '../src/pluggable'

interface Args extends olly.ComponentArgs {
    tag: string
    datasources: pluggable.GrafanaDS[]
    ingress?: any // TODO 
    dashboards?: any[] // TODO
}

export default class Example extends olly.ComponentResource implements pluggable.ScrapeTarget {

    readonly metrics: pluggable.ScrapeTargetItem[]

    private readonly args: Args

    constructor(name: string, args: Args, opts?: pulumi.ComponentResourceOptions) {
        super(olly.ComponentType.Dashboard, name, args, opts)
        this.args = args

        const configmap = this.createConfigMap()
        const deployment = this.createDeployment(configmap)
        const service = this.createService(deployment)
        this.createIngress(service)

        this.metrics = [{
            endpoint: service.metadata.name,
            port: service.spec.ports[0].name,
            namespace: service.metadata.namespace,
        }]
    }

    private createConfigMap(): k8s.core.v1.ConfigMap {

        // create datasources based on passed components
        const dsNames:string[] = []
        const dsTypes:string[] = []
        const dsUrls:pulumi.Output<string>[] = []
        const dsDatas:any[] = []
        
        for (const c of this.args.datasources) {
            const { name, type, URL, data = {} } = c.datasource
            dsNames.push(name)
            dsTypes.push(type)
            dsUrls.push(URL)
            dsDatas.push(data)
        }
        
        const ds = {
            apiVersion: 1,
            datasources: <any>[]
        }
        return new k8s.core.v1.ConfigMap(this.name, {
            metadata: {
                name: this.name,
                namespace: this.args.namespace,
                labels: this.labels,
            },
            data: {
                'grafana.ini': ini.encode(this.getGrafanaConfig()),
                'datasources.yaml': pulumi
                    .all(dsUrls)
                    .apply(urls => {
                        ds.datasources = urls.map((url, i) => {
                            return {
                                name: dsNames[i],
                                type: dsTypes[i],
                                access: 'proxy',
                                editable: false,
                                jsonData: dsDatas[i],
                                url: url,
                            }
                        })
                        return yaml.safeDump(ds)
                    }),
            }
        }, { parent: this })
    }

    private createDeployment(configmap: k8s.core.v1.ConfigMap): k8s.apps.v1.Deployment {

        const container: k8s.types.input.core.v1.Container = {
            name: 'grafana',
            image: `grafana/grafana:${this.args.tag}`,
            ports: [ { name: 'http', containerPort: 3000 } ],
            readinessProbe: {
                httpGet: {
                    port: 'http',
                    path: '/api/health',
                },
            },
            livenessProbe: {
                tcpSocket: {
                    port: 'http',
                },
            },
            volumeMounts: [
                { name: 'storage', mountPath: '/var/lib/grafana' },
                {
                    name: 'config',
                    mountPath: '/etc/grafana/provisioning/datasources/datasources.yaml',
                    subPath: 'datasources.yaml',
                    readOnly: true,
                },
                {
                    name: 'config',
                    mountPath: '/etc/grafana/grafana.ini',
                    subPath: 'grafana.ini',
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
                ports: [{ name: 'http', port: 3000, targetPort: 'http' }],
                selector: deployment.spec.selector.matchLabels,
            },
        }, { parent: this })
    }

    private createIngress(service: k8s.core.v1.Service): void {
        new k8s.networking.v1beta1.Ingress(this.name, {
            metadata: {
                name: this.name,
                namespace: service.metadata.namespace,
                annotations: {
                    'kubernetes.io/ingress.class': 'nginx'
                }
            },
            spec: {
                rules: [{
                    host: 'grafana.domain.tld',
                    http: {
                        paths: [{
                            backend: {
                                serviceName: service.metadata.name,
                                servicePort: service.spec.ports[0].name,
                            },
                            path: '/',
                        }]
                    }
                }]
            }
        }, { parent: this })
    }

    // https://grafana.com/docs/grafana/latest/administration/configuration/
    private getGrafanaConfig() {
        return {
            analytics: {
                reporting_enabled: false,
            },
            server: {
                root_url: 'http://localhost:3000',
                router_logging: false,
                enable_gzip: true,
            },
            // database: {
            //     url: 'postgres://user:secret@host:port/database'
            // },
            security: {
                cookie_secure: true,
                disable_brute_force_login_protection: true,
                x_xss_protection: true,
                admin_user: 'admin',
                admin_password: 'admin',
            },
            dataproxy: {
                timeout: 300,
                send_user_header: true,
            },
            log: {
                mode: 'console',
                console: {
                    level: 'warn',
                    format: 'text',
                },
            },
            auth: {
                disable_login_form: true,
                disable_signout_menu: true,
                anonymous: {
                    enabled: true,
                    org_role: 'Admin',
                }
            },
            panels: {
                enable_alpha: true,
            },
            tracing: {
                jaeger: {
                    address: 'localhost:6831',
                    sampler_type: 'const',
                    sampler_param: '1',
                }
            }
        }
    }}
