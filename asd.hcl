schema_version = "3.0"
project_name   = "asd"

group "asd" {
  label = "asd"

  service "AWS Application Migration Service" "aws_application_migration_service" {
    region      = "us-east-1"
    human_label = "AWS Application Migration Service"

    dimension "Description - optional"    = "asdasd"
    dimension "Number of server/s Number" = "asd"
  }

  service "Amazon CloudWatch" "amazon_cloudwatch" {
    region      = "us-east-1"
    human_label = "Amazon CloudWatch"

    dimension "Description - optional"                                                      = "123123"
    dimension "Expected Logs Data scanned Value"                                            = ""
    dimension "Infrequent Access Logs Delivered to CloudWatch Logs Value"                   = ""
    dimension "Infrequent Access Logs: Data Ingested Value"                                 = ""
    dimension "Logs Delivered to S3: Data Ingested Value"                                   = ""
    dimension "Mobile sampling rate Enter the amount"                                       = "100"
    dimension "Number of Aurora Capacity Units (ACUs) monitored by Database Insights Value" = ""
    dimension "Number of city-networks to be monitored Value"                               = ""
    dimension "Number of mobile OTEL events and spans or spans per visit Enter the amount"  = "70"
    dimension "Number of monitored resources Value"                                         = ""
    dimension "Number of requests per function Value"                                       = ""
    dimension "Number of vCPUs monitored by Database Insights Value"                        = ""
    dimension "Standard Logs Delivered to CloudWatch Logs Value"                            = ""
    dimension "Standard Logs: Data Ingested Value"                                          = ""
    dimension "Total number of events for DynamoDB Value"                                   = ""
    dimension "Total number of matched log events for CloudWatch Value"                     = ""
    dimension "Volume of incoming requests Value"                                           = ""
    dimension "Volume of outgoing requests to dependencies Value"                           = ""
    dimension "Web sampling rate Enter the amount"                                          = ""
  }

  service "Amazon Athena" "amazon_athena" {
    region      = "us-east-1"
    human_label = "Amazon Athena"

    dimension "Amount of data scanned per query Value"  = ""
    dimension "Code execution per session Value"        = ""
    dimension "Length of time capacity is active Value" = ""
    dimension "Total number of queries Value"           = ""
    dimension "Total number of spark sessions Value"    = ""
  }
}
